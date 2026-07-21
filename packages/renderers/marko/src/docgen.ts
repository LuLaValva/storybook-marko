/**
 * Node-only docgen for Marko components: reads the JSDoc descriptions, types,
 * required-ness and `@default` values of a component's exported `Input` type.
 *
 * The `.marko` source becomes a virtual TypeScript module via
 * `@marko/language-tools` (the same extraction `@marko/type-check` uses) and
 * everything is read back through the TypeScript checker's semantic APIs.
 * Results are shaped like react-docgen `tsType` output so that
 * `storybook/internal/docs-tools` can consume them as `__docgenInfo`.
 *
 * Docs extraction is opt-in via the project's own (optional peer) `typescript`
 * install; without it docgen is silently skipped.
 */
import path from "node:path";

import { Processors, Project } from "@marko/language-tools";
import type TS from "typescript/lib/tsserverlibrary";

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

const fsPathReg = /^(?:[./\\]|[A-Z]:)/i;
const importTagReg = /^<([^>]+)>$/;
let shared: Promise<MarkoDocgen | undefined> | undefined;

/**
 * Appends a `__docgenInfo` assignment for `fileName` onto its compiled
 * `code`, lazily sharing one docgen project across all calls. Returns
 * undefined when there is nothing to attach.
 */
export async function withDocgenInfo(
  code: string,
  fileName: string,
): Promise<string | undefined> {
  const docgen = await (shared ??= createMarkoDocgen());
  const info = docgen?.getDocgenInfo(fileName);
  if (!info || !Object.keys(info.props).length) return;
  // Capture the default export (an arbitrary expression in compiled Marko
  // output) so `__docgenInfo` can be attached to it.
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
  try {
    ts = ((await import("typescript/lib/tsserverlibrary.js")) as any)
      .default as typeof TS;
  } catch {
    // TypeScript isn't installed in this project: disable docgen.
    return undefined;
  }

  const host = ts.sys;
  const dir = host.getCurrentDirectory();
  const configFile =
    ts.findConfigFile(dir, host.fileExists, "tsconfig.json") ||
    ts.findConfigFile(dir, host.fileExists, "jsconfig.json");
  const processors = Processors.create({ ts, host, configFile });
  const getProcessor = (fileName: string) => {
    const ext = Processors.getProcessorExtension(fileName);
    return ext ? processors[ext] : undefined;
  };

  const compilerOptions: TS.CompilerOptions = {
    ...(configFile
      ? ts.getParsedCommandLineOfConfigFile(configFile, undefined, {
          ...host,
          onUnRecoverableConfigFileDiagnostic() {},
        })?.options
      : undefined),
    noEmit: true,
    allowJs: true,
    skipLibCheck: true,
    allowNonTsExtensions: true,
  };
  const resolutionCache = ts.createModuleResolutionCache(
    dir,
    host.useCaseSensitiveFileNames
      ? (fileName) => fileName
      : (fileName) => fileName.toLowerCase(),
    compilerOptions,
  );

  // The processor runtime type definitions plus files added by docgen calls.
  const rootNames = new Set<string>();
  for (const ext in processors) {
    for (const rootName of processors[
      ext as Processors.ProcessorExtension
    ].getRootNames?.() || []) {
      rootNames.add(rootName);
    }
  }

  const service = ts.createLanguageService({
    getCompilationSettings: () => compilerOptions,
    getScriptFileNames: () => [...rootNames],
    getScriptVersion: (fileName) =>
      `${host.getModifiedTime?.(fileName)?.getTime() ?? 0}`,
    getScriptSnapshot(fileName) {
      const code = host.readFile(fileName);
      if (code === undefined) return undefined;
      const processor = getProcessor(fileName);
      let extractedCode = code;
      if (processor) {
        try {
          extractedCode = processor.extract(fileName, code).toString();
        } catch {
          // Extraction (eg parse) errors check as an empty file.
          extractedCode = "";
        }
      }
      return ts.ScriptSnapshot.fromString(extractedCode);
    },
    // ScriptKind.Unknown falls back to extension based detection.
    getScriptKind: (fileName) =>
      getProcessor(fileName)?.getScriptKind(fileName) ?? ts.ScriptKind.Unknown,
    // Resolve `<tag>` imports and on-disk paths of processed files; anything
    // else uses standard bundler resolution. Specifiers that don't resolve
    // degrade to `any` (which doesn't affect Input docs) instead of failing.
    resolveModuleNameLiterals: (
      literals,
      containingFile,
      redirectedReference,
    ) =>
      literals.map(({ text }) => {
        let moduleName = text;
        const tagName = importTagReg.exec(moduleName)?.[1];
        if (tagName) {
          const tagDef = Project.getTagLookup(
            path.dirname(containingFile),
          ).getTag(tagName);
          moduleName = (tagDef && (tagDef.template || tagDef.renderer)) || text;
        }
        const processor = getProcessor(moduleName);
        if (processor && fsPathReg.test(moduleName)) {
          const resolvedFileName = path.resolve(
            containingFile,
            "..",
            moduleName,
          );
          return {
            resolvedModule: host.fileExists(resolvedFileName)
              ? {
                  resolvedFileName,
                  extension: processor.getScriptExtension(resolvedFileName),
                  isExternalLibraryImport: false,
                }
              : undefined,
          };
        }
        return ts.bundlerModuleNameResolver(
          moduleName,
          containingFile,
          compilerOptions,
          host,
          resolutionCache,
          redirectedReference,
        );
      }),
    readDirectory: host.readDirectory,
    readFile: host.readFile,
    fileExists: host.fileExists,
    directoryExists: host.directoryExists,
    getDirectories: host.getDirectories,
    realpath: host.realpath,
    getCurrentDirectory: () => dir,
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    useCaseSensitiveFileNames: () => host.useCaseSensitiveFileNames,
  });

  function tsTypeOf(checker: TS.TypeChecker, type: TS.Type): DocgenTsType {
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
    // Long type text is displayed as-is, so truncate the excessive ones.
    return { name: raw.length > 80 ? `${raw.slice(0, 79)}…` : raw };
  }

  /** The nested member type when `type` is a `Marko.AttrTag`. */
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
      // Matches `Marko.AttrTag` / `global.Marko.AttrTag`.
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
      // JSDoc tags come only from in-project declarations: a prop overriding
      // a native attribute (eg `disabled` narrowing `Marko.HTML.Button`'s)
      // must not inherit the lib declaration's `@see` etc.
      for (const decl of prop.declarations || []) {
        if (decl.getSourceFile().fileName.includes("/node_modules/")) continue;
        for (const tag of ts.getJSDocTags(decl)) {
          const name = tag.tagName.text;
          const text = ts.getTextOfJSDocComment(tag.comment) ?? "";
          if (name === "default" || name === "defaultValue") {
            defaultValue = { value: text };
          } else {
            // docs-tools parses remaining tags (eg @deprecated) back out.
            description += `${description ? "\n" : ""}@${name}${text ? ` ${text}` : ""}`;
          }
        }
      }

      const location = prop.valueDeclaration || prop.declarations?.[0];
      const propType = checker.getTypeOfSymbolAtLocation(
        prop,
        location || fallbackLocation,
      );
      const attrTagType = attrTagMemberType(checker, propType);
      // Body content declared as `Marko.Body` displays as written instead of
      // its expanded `Body<[], void>` signature (the checker loses the alias
      // on instantiated optional members, so read the annotation itself).
      // Still function-shaped so no control is inferred for it.
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
        // An attr tag's full type is redundant with its extracted members.
        tsType: attrTagType
          ? { name: "AttrTag" }
          : bodyType || tsTypeOf(checker, propType),
        ...(defaultValue && { defaultValue }),
        ...(attrTagType && {
          "@": docgenProps(checker, attrTagType, location || fallbackLocation),
        }),
      };
    }
    return props;
  }

  return {
    getDocgenInfo(fileName) {
      fileName = path.resolve(dir, fileName);
      rootNames.add(fileName);
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
