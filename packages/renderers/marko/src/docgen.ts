/**
 * Node-only docgen for Marko components: reads the JSDoc descriptions, types,
 * required-ness and `@default` values of a component's exported `Input` type.
 *
 * The `.marko` source becomes a virtual TypeScript module via
 * `@marko/language-tools` (the same extraction `@marko/type-check` uses) and
 * everything is read back through the TypeScript checker's semantic APIs.
 * Results are shaped like react-docgen `tsType` output so that
 * `storybook/internal/docs-tools` can consume them as `__docgenInfo`.
 */
import path from "node:path";

import { getExt, Processors, Project } from "@marko/language-tools";
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
}

export interface DocgenInfo {
  displayName: string;
  description: string;
  props: Record<string, DocgenProp>;
}

export interface MarkoDocgen {
  getDocgenInfo(fileName: string): DocgenInfo | undefined;
}

const fsPathReg = /^(?:[./\\]|[A-Z]:)/i;
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
  const project = await (shared ??= createMarkoDocgen(process.cwd()));
  const info = project?.getDocgenInfo(fileName);
  if (!info || !Object.keys(info.props).length) return;
  const exported = /\bexport\s+default\s+([A-Za-z_$][\w$]*)\s*;/.exec(code);
  if (!exported) return;
  return `${code}\n;try { ${exported[1]}.__docgenInfo = ${JSON.stringify(
    info,
  )}; } catch {}\n`;
}

export async function createMarkoDocgen(
  rootDir: string,
): Promise<MarkoDocgen | undefined> {
  let ts: typeof TS;
  try {
    ts = ((await import("typescript/lib/tsserverlibrary.js")) as any)
      .default as typeof TS;
  } catch {
    // TypeScript isn't installed in this project: disable docgen.
    return undefined;
  }

  rootDir = path.resolve(rootDir);
  const host = ts.sys;
  const configFile = ts.findConfigFile(
    rootDir,
    host.fileExists,
    "tsconfig.json",
  );
  const processors = Processors.create({ ts, host, configFile });
  const getProcessor = (fileName: string) => {
    const ext = getExt(fileName);
    return ext ? processors[ext] : undefined;
  };
  const typeLibs = Project.getTypeLibs(rootDir, ts, host);
  const compilerOptions: TS.CompilerOptions = {
    ...(configFile
      ? ts.getParsedCommandLineOfConfigFile(configFile, undefined, {
          ...host,
          onUnRecoverableConfigFileDiagnostic() {},
        })?.options
      : undefined),
    allowJs: true,
    checkJs: false,
    noEmit: true,
    declaration: false,
    composite: false,
    incremental: false,
    skipLibCheck: true,
    allowNonTsExtensions: true,
  };
  const rootNames = new Set(
    [
      typeLibs.internalTypesFile,
      typeLibs.markoTypesFile,
      typeLibs.markoRunTypesFile,
      typeLibs.markoRunGeneratedTypesFile,
    ].filter(Boolean) as string[],
  );
  const resolutionCache = ts.createModuleResolutionCache(
    rootDir,
    (fileName) => fileName,
    compilerOptions,
  );

  const service = ts.createLanguageService({
    getCompilationSettings: () => compilerOptions,
    getScriptFileNames: () => [...rootNames],
    getScriptVersion: (fileName) =>
      `${host.getModifiedTime?.(fileName)?.getTime() ?? 0}`,
    getScriptSnapshot(fileName) {
      const code = host.readFile(fileName);
      if (code === undefined) return undefined;
      const extracted = getProcessor(fileName)?.extract(fileName, code);
      return ts.ScriptSnapshot.fromString(
        extracted ? extracted.toString() : code,
      );
    },
    // ScriptKind.Unknown falls back to extension based detection.
    getScriptKind: (fileName) =>
      getProcessor(fileName)?.getScriptKind(fileName) ?? ts.ScriptKind.Unknown,
    // Resolve relative imports of `.marko` files; everything else standard.
    resolveModuleNameLiterals: (
      literals,
      containingFile,
      redirectedReference,
    ) =>
      literals.map(({ text }) => {
        const processor = getProcessor(text);
        if (processor && fsPathReg.test(text)) {
          const resolvedFileName = path.resolve(containingFile, "..", text);
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
          text,
          containingFile,
          compilerOptions,
          host,
          resolutionCache,
          redirectedReference,
        );
      }),
    readFile: host.readFile,
    fileExists: host.fileExists,
    readDirectory: host.readDirectory,
    directoryExists: host.directoryExists,
    getDirectories: host.getDirectories,
    realpath: host.realpath,
    getCurrentDirectory: () => rootDir,
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
    return { name: raw };
  }

  return {
    getDocgenInfo(fileName) {
      fileName = path.resolve(fileName);
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
      if (!inputSymbol) return;

      const props: Record<string, DocgenProp> = {};
      for (const prop of checker!.getPropertiesOfType(
        checker!.getDeclaredTypeOfSymbol(inputSymbol),
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
          prop.getDocumentationComment(checker!),
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
            checker!,
            checker!.getTypeOfSymbolAtLocation(prop, declaration || sourceFile),
          ),
          ...(defaultValue && { defaultValue }),
        };
      }

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
