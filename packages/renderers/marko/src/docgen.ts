/**
 * Node-only docgen for Marko components: reads docs from the exported `Input`
 * type through the TypeScript checker (via the optional `typescript` peer)
 * into react-docgen shaped `__docgenInfo`.
 */
import path from "node:path";

import type TS from "typescript/lib/tsserverlibrary";

type LanguageTools = typeof import("@marko/language-tools");

export interface DocgenTsType {
  name: string;
  raw?: string;
  value?: string;
  type?: "function";
  elements?: DocgenTsType[];
}

export interface DocgenProp {
  description: string;
  required: boolean;
  tsType: DocgenTsType;
  defaultValue?: { value: string };
  /** Nested members when the prop is a `Marko.AttrTag`. */
  "@"?: Record<string, DocgenProp>;
}

export interface DocgenInfo {
  displayName: string;
  description: string;
  props: Record<string, DocgenProp>;
}

interface MarkoDocgen {
  getDocgenInfo(fileName: string): DocgenInfo | undefined;
}

let shared: Promise<MarkoDocgen | undefined> | undefined;

/** Appends a `__docgenInfo` assignment for `fileName` onto its compiled `code`. */
export async function withDocgenInfo(
  code: string,
  fileName: string,
): Promise<string | undefined> {
  const docgen = await (shared ??= createMarkoDocgen());
  const info = docgen?.getDocgenInfo(fileName);
  if (!info || !Object.keys(info.props).length) return;
  // The default export is an arbitrary expression; name it to attach to it.
  const exported = /^export default /m.exec(code);
  if (!exported) return;
  const id = "__MARKO_DOCGEN_DEFAULT__";
  return `${code.slice(0, exported.index)}const ${id} = ${code.slice(
    exported.index + exported[0].length,
  )}\n;export default ${id};try { ${id}.__docgenInfo = ${JSON.stringify(
    info,
  )}; } catch {}\n`;
}

async function createMarkoDocgen(): Promise<MarkoDocgen | undefined> {
  let ts: typeof TS;
  let createLanguageService: LanguageTools["createLanguageService"];
  try {
    [ts, { createLanguageService }] = await Promise.all([
      import("typescript/lib/tsserverlibrary.js").then(
        (mod) => (mod as any).default as typeof TS,
      ),
      import("@marko/language-tools"),
    ]);
  } catch {
    return undefined;
  }

  // The factory shipped in @marko/language-tools 2.7; older installs just
  // don't get docgen, like installs without the typescript peer.
  if (!createLanguageService) return undefined;

  const dir = ts.sys.getCurrentDirectory();
  const { service, addRootName } = createLanguageService({ ts });

  function tsTypeOf(checker: TS.TypeChecker, type: TS.Type): DocgenTsType {
    const raw = checker.typeToString(type);
    if (type.isUnion()) {
      const elements: DocgenTsType[] = [];
      const boolLiterals: string[] = [];
      for (const member of type.types) {
        if (member.flags & ts.TypeFlags.Undefined) continue;
        if (member.flags & ts.TypeFlags.BooleanLiteral) {
          boolLiterals.push(checker.typeToString(member));
        } else {
          elements.push(tsTypeOf(checker, member));
        }
      }
      // The checker expands `boolean` to `true | false`; fold it back.
      if (boolLiterals.length === 2) elements.push({ name: "boolean" });
      else
        for (const value of boolLiterals)
          elements.push({ name: "literal", value });
      return elements.length === 1
        ? elements[0]
        : { name: "union", raw, elements };
    }
    if (type.isStringLiteral() || type.isNumberLiteral()) {
      return { name: "literal", value: raw };
    }
    if (type.getCallSignatures().length) {
      return { name: "signature", type: "function", raw };
    }
    return { name: raw.length > 80 ? `${raw.slice(0, 79)}…` : raw };
  }

  function attrTagMemberType(
    checker: TS.TypeChecker,
    type: TS.Type,
  ): TS.Type | undefined {
    if (type.isUnion()) {
      for (const member of type.types) {
        if (!(member.flags & ts.TypeFlags.Undefined)) {
          return attrTagMemberType(checker, member);
        }
      }
      return;
    }
    const alias = type.aliasSymbol;
    return alias &&
      type.aliasTypeArguments?.length === 1 &&
      /(?:^|\.)Marko\.AttrTag$/.test(checker.getFullyQualifiedName(alias))
      ? type.aliasTypeArguments[0]
      : undefined;
  }

  function docgenProps(
    checker: TS.TypeChecker,
    type: TS.Type,
    fallbackLocation: TS.Node,
  ): Record<string, DocgenProp> {
    const props: Record<string, DocgenProp> = {};
    for (const prop of checker.getPropertiesOfType(type)) {
      // Inherited native attributes (eg `Input extends Marko.HTML.Input`)
      // are far too many to list.
      if (
        prop.declarations?.length &&
        prop.declarations.every((decl) =>
          decl.getSourceFile().fileName.includes("/node_modules/"),
        )
      ) {
        continue;
      }

      // JSDoc comes only from in-project declarations so re-declared native
      // attributes don't inherit the lib's docs, deduped since intersections
      // can repeat a declaration on the symbol.
      let description = "";
      let defaultValue: { value: string } | undefined;
      for (const decl of new Set(prop.declarations)) {
        if (decl.getSourceFile().fileName.includes("/node_modules/")) continue;
        for (const jsDoc of ts.getJSDocCommentsAndTags(decl)) {
          if (!ts.isJSDoc(jsDoc)) continue;
          const text = ts.getTextOfJSDocComment(jsDoc.comment);
          if (text && !description.includes(text)) {
            description += `${description ? "\n" : ""}${text}`;
          }
        }
        for (const tag of ts.getJSDocTags(decl)) {
          const name = tag.tagName.text;
          const text = ts.getTextOfJSDocComment(tag.comment) ?? "";
          if (name === "default" || name === "defaultValue") {
            defaultValue = { value: text };
          } else {
            // docs-tools parses remaining tags (eg @deprecated) back out.
            const tagText = `@${name}${text ? ` ${text}` : ""}`;
            if (!description.includes(tagText)) {
              description += `${description ? "\n" : ""}${tagText}`;
            }
          }
        }
      }

      const location = prop.valueDeclaration || prop.declarations?.[0];
      const propType = checker.getTypeOfSymbolAtLocation(
        prop,
        location || fallbackLocation,
      );
      const attrTagType = attrTagMemberType(checker, propType);
      // The checker expands `Marko.Body` on optional members, so display the
      // annotation as written (function-shaped so no control is inferred).
      const declaredText =
        location && ts.isPropertySignature(location) && location.type
          ? location.type.getText()
          : undefined;
      const bodyType =
        declaredText && /^(?:global\.)?Marko\.Body\b/.test(declaredText)
          ? ({
              name: "signature",
              type: "function",
              raw: declaredText,
            } as const)
          : undefined;
      props[prop.name] = {
        description,
        required: !(prop.flags & ts.SymbolFlags.Optional),
        tsType: attrTagType
          ? { name: "AttrTag" }
          : bodyType || tsTypeOf(checker, propType),
        ...(defaultValue && { defaultValue }),
        ...(attrTagType && {
          "@": docgenProps(checker, attrTagType, location || fallbackLocation),
        }),
      };
    }
    // A union itself only exposes props common to every member; merge
    // member-only props in as optional.
    if (type.isUnion()) {
      for (const member of type.types) {
        const memberProps = docgenProps(checker, member, fallbackLocation);
        for (const name in memberProps) {
          if (!(name in props)) {
            props[name] = { ...memberProps[name], required: false };
          }
        }
      }
    }
    return props;
  }

  return {
    getDocgenInfo(fileName) {
      fileName = path.resolve(dir, fileName);
      addRootName(fileName);
      const program = service.getProgram();
      const checker = program?.getTypeChecker();
      const sourceFile = program?.getSourceFile(fileName);
      const moduleSymbol =
        sourceFile && checker?.getSymbolAtLocation(sourceFile);
      const inputSymbol =
        moduleSymbol &&
        checker!
          .getExportsOfModule(moduleSymbol)
          .find((exportSymbol) => exportSymbol.name === "Input");
      if (!sourceFile || !inputSymbol) return;

      const props = docgenProps(
        checker!,
        checker!.getDeclaredTypeOfSymbol(inputSymbol),
        sourceFile,
      );
      const basename = path.basename(fileName, ".marko");
      return {
        displayName:
          basename === "index"
            ? path.basename(path.dirname(fileName))
            : basename,
        description: ts.displayPartsToString(
          inputSymbol.getDocumentationComment(checker!),
        ),
        props,
      };
    },
  };
}
