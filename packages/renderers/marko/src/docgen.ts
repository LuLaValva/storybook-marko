/**
 * Node-only docgen for Marko components.
 *
 * Extracts JSDoc descriptions, types, required-ness and default values from a
 * component's exported `Input` type. The `.marko` source is converted to a
 * virtual TypeScript module via `@marko/language-tools` (the same extraction
 * used by `@marko/type-check`), then all information is read through the
 * TypeScript checker's semantic APIs — no manual AST traversal.
 *
 * The result is shaped like react-docgen output (`tsType` flavor) so that
 * `storybook/internal/docs-tools` can consume it as `component.__docgenInfo`.
 */
import crypto from "node:crypto";
import path from "node:path";

import { getExt, Processors, Project } from "@marko/language-tools";
import type TS from "typescript/lib/tsserverlibrary";

export interface DocgenTsType {
  name: string;
  raw?: string;
  value?: unknown;
  type?: string;
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
const importTagReg = /^<([^>]+)>$/;
const modulePartsReg = /^((?:@(?:[^/]+)\/)?(?:[^/]+))(.*)$/;

export async function createMarkoDocgen(opts: {
  rootDir: string;
}): Promise<MarkoDocgen | undefined> {
  let ts: typeof TS;
  try {
    ts = ((await import("typescript/lib/tsserverlibrary.js")) as any)
      .default as typeof TS;
  } catch {
    // TypeScript isn't installed in this project: disable docgen.
    return undefined;
  }

  const rootDir = path.resolve(opts.rootDir);
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
      ? ts.getParsedCommandLineOfConfigFile(
          configFile,
          undefined,
          {
            ...host,
            onUnRecoverableConfigFileDiagnostic() {},
          },
          undefined,
          undefined,
          Processors.extensions.map((extension) => ({
            extension,
            isMixedContent: false,
            scriptKind: ts.ScriptKind.Deferred,
          })),
        )?.options
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

  const rootNames = new Set<string>(
    [
      typeLibs.internalTypesFile,
      typeLibs.markoTypesFile,
      typeLibs.markoRunTypesFile,
      typeLibs.markoRunGeneratedTypesFile,
    ].filter(Boolean) as string[],
  );
  const versions = new Map<string, string>();
  const resolutionCache = ts.createModuleResolutionCache(
    rootDir,
    (fileName) => fileName,
    compilerOptions,
  );

  const serviceHost: TS.LanguageServiceHost = {
    getCompilationSettings: () => compilerOptions,
    getScriptFileNames: () => [...rootNames],
    getScriptVersion(fileName) {
      const code = host.readFile(fileName);
      if (code === undefined) return "unknown";
      const version = crypto.createHash("md5").update(code).digest("hex");
      versions.set(fileName, version);
      return version;
    },
    getScriptSnapshot(fileName) {
      const code = host.readFile(fileName);
      if (code === undefined) return undefined;
      const processor = getProcessor(fileName);
      return ts.ScriptSnapshot.fromString(
        processor ? processor.extract(fileName, code).toString() : code,
      );
    },
    getScriptKind(fileName) {
      const processor = getProcessor(fileName);
      if (processor) return processor.getScriptKind(fileName);
      switch (path.extname(fileName)) {
        case ".js":
        case ".cjs":
        case ".mjs":
          return ts.ScriptKind.JS;
        case ".json":
          return ts.ScriptKind.JSON;
        default:
          return ts.ScriptKind.TS;
      }
    },
    resolveModuleNameLiterals(
      moduleLiterals,
      containingFile,
      redirectedReference,
    ) {
      return moduleLiterals.map((moduleLiteral) => {
        let moduleName = moduleLiteral.text;
        const tagNameMatch = importTagReg.exec(moduleName);
        if (tagNameMatch) {
          const tagDef = Project.getTagLookup(
            path.dirname(containingFile),
          ).getTag(tagNameMatch[1]);
          const tagFileName = tagDef && (tagDef.template || tagDef.renderer);
          if (tagFileName) moduleName = tagFileName;
        }

        const processor =
          moduleName[0] !== "*" ? getProcessor(moduleName) : undefined;
        if (processor) {
          let isExternalLibraryImport = false;
          let resolvedFileName: string | undefined;
          if (fsPathReg.test(moduleName)) {
            resolvedFileName = path.resolve(containingFile, "..", moduleName);
          } else {
            const [, nodeModuleName, relativeModulePath] =
              modulePartsReg.exec(moduleName)!;
            const { resolvedModule } = ts.nodeModuleNameResolver(
              `${nodeModuleName}/package.json`,
              containingFile,
              compilerOptions,
              host,
              resolutionCache,
              redirectedReference,
            );
            if (resolvedModule) {
              isExternalLibraryImport = true;
              resolvedFileName = path.join(
                resolvedModule.resolvedFileName,
                "..",
                relativeModulePath,
              );
            }
          }

          if (resolvedFileName && !host.fileExists(resolvedFileName)) {
            resolvedFileName = undefined;
          }

          return {
            resolvedModule: resolvedFileName
              ? {
                  resolvedFileName,
                  extension: processor.getScriptExtension(resolvedFileName),
                  isExternalLibraryImport,
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
      });
    },
    readFile: host.readFile,
    fileExists: host.fileExists,
    readDirectory: host.readDirectory,
    directoryExists: host.directoryExists,
    getDirectories: host.getDirectories,
    realpath: host.realpath,
    getCurrentDirectory: () => rootDir,
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    useCaseSensitiveFileNames: () => host.useCaseSensitiveFileNames,
  };

  const service = ts.createLanguageService(serviceHost);

  function tsTypeOf(
    checker: TS.TypeChecker,
    type: TS.Type,
    depth = 0,
  ): DocgenTsType {
    const raw = checker.typeToString(type);
    if (type.flags & ts.TypeFlags.StringLiteral) {
      return { name: "literal", value: raw };
    }
    if (
      type.flags &
      (ts.TypeFlags.NumberLiteral | ts.TypeFlags.BigIntLiteral)
    ) {
      return { name: "literal", value: raw };
    }
    if (
      type.flags &
      (ts.TypeFlags.String |
        ts.TypeFlags.Number |
        ts.TypeFlags.Boolean |
        ts.TypeFlags.ESSymbol |
        ts.TypeFlags.Undefined |
        ts.TypeFlags.Null |
        ts.TypeFlags.Void)
    ) {
      return { name: raw };
    }
    if (type.isUnion() && depth < 2) {
      // The checker expands `boolean` to `true | false`; fold it back.
      const elements: DocgenTsType[] = [];
      let sawTrue = false;
      let sawFalse = false;
      for (const member of type.types) {
        if (member.flags & ts.TypeFlags.BooleanLiteral) {
          if (checker.typeToString(member) === "true") sawTrue = true;
          else sawFalse = true;
          continue;
        }
        elements.push(tsTypeOf(checker, member, depth + 1));
      }
      if (sawTrue && sawFalse) elements.push({ name: "boolean" });
      else if (sawTrue || sawFalse) {
        elements.push({ name: "literal", value: sawTrue ? "true" : "false" });
      }
      // Unwrap optional props (`T | undefined`) so docs show `T` rather
      // than `union` while remaining unions still infer enum controls.
      const definedElements = elements.filter(
        (element) => element.name !== "undefined",
      );
      if (definedElements.length === 1) return definedElements[0];
      return { name: "union", raw, elements };
    }
    if (type.getCallSignatures().length > 0) {
      return { name: "signature", type: "function", raw };
    }
    return { name: raw, raw };
  }

  return {
    getDocgenInfo(fileName) {
      fileName = path.resolve(fileName);
      if (!rootNames.has(fileName)) rootNames.add(fileName);
      const program = service.getProgram();
      const sourceFile = program?.getSourceFile(fileName);
      if (!program || !sourceFile) return undefined;

      const checker = program.getTypeChecker();
      const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
      if (!moduleSymbol) return undefined;
      const inputSymbol = checker
        .getExportsOfModule(moduleSymbol)
        .find((exportSymbol) => exportSymbol.name === "Input");
      if (!inputSymbol) return undefined;

      const props: Record<string, DocgenProp> = {};
      const inputType = checker.getDeclaredTypeOfSymbol(inputSymbol);
      for (const prop of checker.getPropertiesOfType(inputType)) {
        // Skip props inherited from types declared outside the project
        // (eg `Input extends Marko.HTML.Input` pulls in hundreds of
        // global HTML attributes).
        if (
          prop.declarations?.length &&
          prop.declarations.every((decl) =>
            decl.getSourceFile().fileName.includes("/node_modules/"),
          )
        ) {
          continue;
        }
        const declaration = prop.valueDeclaration || prop.declarations?.[0];
        const propType = checker.getTypeOfSymbolAtLocation(
          prop,
          declaration || sourceFile,
        );

        let description = ts.displayPartsToString(
          prop.getDocumentationComment(checker),
        );
        let defaultValue: { value: string } | undefined;
        for (const tag of prop.getJsDocTags(checker)) {
          const text = ts.displayPartsToString(tag.text);
          if (tag.name === "default" || tag.name === "defaultValue") {
            defaultValue = { value: text };
          } else {
            // Keep other tags (eg `@deprecated`, `@ignore`) in the
            // description; storybook's docs-tools parses them back out.
            description += `${description ? "\n" : ""}@${tag.name}${text ? ` ${text}` : ""}`;
          }
        }

        props[prop.name] = {
          description,
          required: !(prop.flags & ts.SymbolFlags.Optional),
          tsType: tsTypeOf(checker, propType),
          ...(defaultValue ? { defaultValue } : undefined),
        };
      }

      const basename = path.basename(fileName, ".marko");
      return {
        displayName:
          basename === "index"
            ? path.basename(path.dirname(fileName))
            : basename,
        description: ts.displayPartsToString(
          inputSymbol.getDocumentationComment(checker),
        ),
        props,
      };
    },
  };
}

/**
 * Appends an assignment of `__docgenInfo` onto a compiled `.marko` module.
 * Returns undefined when there is nothing to attach or the module's default
 * export could not be located.
 */
export function attachDocgenInfo(
  compiledCode: string,
  docgenInfo: DocgenInfo | undefined,
): string | undefined {
  if (!docgenInfo || !Object.keys(docgenInfo.props).length) return undefined;
  const exported = /\bexport\s+default\s+([A-Za-z_$][\w$]*)\s*;/.exec(
    compiledCode,
  );
  if (!exported) return undefined;
  return `${compiledCode}\n;try { ${exported[1]}.__docgenInfo = ${JSON.stringify(
    docgenInfo,
  )}; } catch {}\n`;
}
