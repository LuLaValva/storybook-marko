/**
 * Node-only docgen for Marko components: reads the JSDoc descriptions, types,
 * required-ness and `@default` values of a component's exported `Input` type.
 *
 * `@marko/type-check`'s programmatic project API provides a Marko-aware
 * TypeScript language service, and everything is read back through the
 * TypeScript checker's semantic APIs. Results are shaped like react-docgen
 * `tsType` output so that `storybook/internal/docs-tools` can consume them
 * as `__docgenInfo`.
 */
import path from "node:path";

import type { Project } from "@marko/type-check";

// Semantic types from the TypeScript instance backing the docgen project
// (which may differ from this repo's own `typescript` dependency).
type TS = Project["ts"];
type TypeChecker = ReturnType<Project["getTypeChecker"]>;
type Type = ReturnType<TypeChecker["getDeclaredTypeOfSymbol"]>;

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
}

export interface DocgenInfo {
  displayName: string;
  description: string;
  props: Record<string, DocgenProp>;
}

let shared: Promise<Project | undefined> | undefined;

/**
 * Appends a `__docgenInfo` assignment for `fileName` onto its compiled
 * `code`, lazily sharing one docgen project across all calls. Returns
 * undefined when there is nothing to attach.
 */
export async function withDocgenInfo(
  code: string,
  fileName: string,
): Promise<string | undefined> {
  const project = await (shared ??= createDocgenProject());
  const info = project && getDocgenInfo(project, fileName);
  if (!info || !Object.keys(info.props).length) return;
  const exported = /\bexport\s+default\s+([A-Za-z_$][\w$]*)\s*;/.exec(code);
  if (!exported) return;
  return `${code}\n;try { ${exported[1]}.__docgenInfo = ${JSON.stringify(
    info,
  )}; } catch {}\n`;
}

async function createDocgenProject(): Promise<Project | undefined> {
  try {
    // Docgen is opt-in via the optional `@marko/type-check` peer dependency;
    // when it's missing (or too old to have `createProject`) docs are skipped.
    const { createProject } = await import("@marko/type-check");
    return createProject();
  } catch {
    return undefined;
  }
}

export function getDocgenInfo(
  project: Project,
  fileName: string,
): DocgenInfo | undefined {
  const { ts } = project;
  fileName = path.resolve(fileName);
  const sourceFile = project.getSourceFile(fileName);
  const checker = project.getTypeChecker();
  const moduleSymbol = sourceFile && checker.getSymbolAtLocation(sourceFile);
  const inputSymbol =
    moduleSymbol &&
    checker
      .getExportsOfModule(moduleSymbol)
      .find((exportSymbol) => exportSymbol.name === "Input");
  if (!sourceFile || !inputSymbol) return;

  const props: Record<string, DocgenProp> = {};
  for (const prop of checker.getPropertiesOfType(
    checker.getDeclaredTypeOfSymbol(inputSymbol),
  )) {
    // Skip props inherited from types declared outside the project (eg
    // `Input extends Marko.HTML.Input` pulls in every HTML attribute).
    if (
      prop.declarations?.length &&
      prop.declarations.every((decl) =>
        decl.getSourceFile().fileName.includes("/node_modules/"),
      )
    ) {
      continue;
    }

    let description = ts.displayPartsToString(
      prop.getDocumentationComment(checker),
    );
    let defaultValue: { value: string } | undefined;
    for (const tag of prop.getJsDocTags(checker)) {
      const text = ts.displayPartsToString(tag.text);
      if (tag.name === "default" || tag.name === "defaultValue") {
        defaultValue = { value: text };
      } else {
        // docs-tools parses remaining tags (eg @deprecated) back out.
        description += `${description ? "\n" : ""}@${tag.name}${text ? ` ${text}` : ""}`;
      }
    }

    const declaration = prop.valueDeclaration || prop.declarations?.[0];
    props[prop.name] = {
      description,
      required: !(prop.flags & ts.SymbolFlags.Optional),
      tsType: tsTypeOf(
        ts,
        checker,
        checker.getTypeOfSymbolAtLocation(prop, declaration || sourceFile),
      ),
      ...(defaultValue && { defaultValue }),
    };
  }

  const basename = path.basename(fileName, ".marko");
  return {
    displayName:
      basename === "index" ? path.basename(path.dirname(fileName)) : basename,
    description: ts.displayPartsToString(
      inputSymbol.getDocumentationComment(checker),
    ),
    props,
  };
}

function tsTypeOf(ts: TS, checker: TypeChecker, type: Type): DocgenTsType {
  const raw = checker.typeToString(type);
  if (type.isUnion()) {
    const elements: DocgenTsType[] = [];
    const boolLiterals: string[] = [];
    for (const member of type.types) {
      // Optionality is tracked via `required`, not the type.
      if (member.flags & ts.TypeFlags.Undefined) continue;
      if (member.flags & ts.TypeFlags.BooleanLiteral) {
        boolLiterals.push(checker.typeToString(member));
      } else {
        elements.push(tsTypeOf(ts, checker, member));
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
  return { name: raw };
}
