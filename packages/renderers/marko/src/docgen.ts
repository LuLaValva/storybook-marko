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

const fsPathReg = /^(?:[./\\]|[A-Z]:)/i;
const importTagReg = /^<([^>]+)>$/;
const warned = new Set<string>();
let shared: Promise<MarkoDocgen | undefined> | undefined;

/**
 * Appends a `__docgenInfo` assignment for `fileName` onto its compiled `code`,
 * or returns undefined when there is nothing to attach. Never throws: docs are
 * best effort, so a failure warns once per file and leaves `code` alone.
 */
export async function withDocgenInfo(
  code: string,
  fileName: string,
): Promise<string | undefined> {
  if (fileName.includes("node_modules")) return;
  try {
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
  } catch (err) {
    if (!warned.has(fileName)) {
      warned.add(fileName);
      console.warn(
        `[storybook:marko-docgen] failed to extract docs from ${fileName}`,
        err,
      );
    }
  }
}

async function createMarkoDocgen(): Promise<MarkoDocgen | undefined> {
  let ts: typeof TS;
  let Processors: LanguageTools["Processors"];
  let Project: LanguageTools["Project"];
  try {
    [ts, { Processors, Project }] = await Promise.all([
      import("typescript/lib/tsserverlibrary.js").then(
        (mod) => (mod as any).default as typeof TS,
      ),
      import("@marko/language-tools"),
    ]);
  } catch {
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

  const rootNames = new Set<string>();
  for (const ext in processors) {
    for (const rootName of processors[
      ext as keyof typeof processors
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
          // Parse errors check as an empty file.
          extractedCode = "";
        }
      }
      return ts.ScriptSnapshot.fromString(extractedCode);
    },
    getScriptKind: (fileName) =>
      getProcessor(fileName)?.getScriptKind(fileName) ?? ts.ScriptKind.Unknown,
    // Unresolved specifiers degrade to `any` rather than failing.
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

  // `Marko.AttrTag<T>` is `T & { [Symbol.iterator](): Iterator<T> }`. Matching
  // that shape rather than the alias symbol also covers aliases of it, eg
  // `export type Header = Marko.AttrTag<{...}>`.
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
    if (!(type.flags & ts.TypeFlags.Intersection)) return;
    const iterator = checker
      .getPropertiesOfType(type)
      .find((prop) => prop.name.startsWith("__@iterator"));
    const iteration = iterator
      ?.getDeclarations()
      ?.map((decl) =>
        checker
          .getTypeOfSymbolAtLocation(iterator, decl)
          .getCallSignatures()[0]
          ?.getReturnType(),
      )
      .find(Boolean);
    return (
      iteration && checker.getTypeArguments(iteration as TS.TypeReference)[0]
    );
  }

  function docgenProps(
    checker: TS.TypeChecker,
    type: TS.Type,
    fallbackLocation: TS.Node,
  ): Record<string, DocgenProp> {
    const props: Record<string, DocgenProp> = {};
    for (const prop of checker.getPropertiesOfType(type)) {
      // Docs come only from in-project declarations, so inherited native
      // attributes (eg `Input extends Marko.HTML.Input`) are dropped rather
      // than listed in full, and re-declared ones don't pick up the lib's docs.
      const declarations = new Set(
        prop.declarations?.filter(
          (decl) => !decl.getSourceFile().fileName.includes("/node_modules/"),
        ),
      );
      if (prop.declarations?.length && !declarations.size) continue;

      const descriptions = new Set<string>();
      let defaultValue: { value: string } | undefined;
      for (const decl of declarations) {
        for (const jsDoc of ts.getJSDocCommentsAndTags(decl)) {
          if (!ts.isJSDoc(jsDoc)) continue;
          const text = ts.getTextOfJSDocComment(jsDoc.comment);
          if (text) descriptions.add(text);
        }
        for (const tag of ts.getJSDocTags(decl)) {
          const name = tag.tagName.text;
          const text = ts.getTextOfJSDocComment(tag.comment) ?? "";
          if (name === "default" || name === "defaultValue") {
            defaultValue = { value: text };
          } else {
            // docs-tools parses remaining tags (eg @deprecated) back out.
            descriptions.add(`@${name}${text ? ` ${text}` : ""}`);
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
        description: [...descriptions].join("\n"),
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
