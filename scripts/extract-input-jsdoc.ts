/**
 * Proof-of-concept: extract JSDoc descriptions from a Marko component's
 * exported `Input` TypeScript type, using the same TS-over-Marko bridge that
 * `mtc` (@marko/type-check) uses under the hood.
 *
 * Usage: node --experimental-strip-types scripts/extract-input-jsdoc.ts <path/to/component.marko>
 *
 * It builds a TS Program where `.marko` files are run through
 * `@marko/language-tools` `Processors`, so the component's `export interface
 * Input { ... }` becomes a real TS type whose property symbols carry their
 * JSDoc (`symbol.getDocumentationComment`) and tags (`getJsDocTags`).
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript/lib/tsserverlibrary.js";
import {
  Processors,
  Project,
  getExt,
  isDefinitionFile,
} from "@marko/language-tools";

const fsPathReg = /^(?:[./\\]|[A-Z]:)/i;
const importTagReg = /^<([^>]+)>$/;
const modulePartsReg = /^((?:@(?:[^/]+)\/)?(?:[^/]+))(.*)$/;

export interface InputProp {
  name: string;
  description: string;
  tags: { name: string; text: string }[];
}

export function extractInputJsDoc(markoFile: string): InputProp[] {
  const abs = path.resolve(markoFile);
  const configFile = ts.findConfigFile(
    path.dirname(abs),
    ts.sys.fileExists,
    "tsconfig.json",
  );

  const options: ts.CompilerOptions = {
    ...(configFile
      ? ts.parseJsonConfigFileContent(
          ts.readConfigFile(configFile, ts.sys.readFile).config,
          ts.sys,
          path.dirname(configFile),
        ).options
      : {}),
    // Lets `.marko` files be program root names despite their unknown
    // extension (mtc sets the same flag in its required compiler options).
    allowNonTsExtensions: true,
    noEmit: true,
    // Neutralize emit options inherited from the project tsconfig
    // (composite/emitDeclarationOnly/incremental conflict with noEmit).
    composite: false,
    declaration: false,
    emitDeclarationOnly: false,
    incremental: false,
    skipLibCheck: true,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ESNext,
  };

  const host = ts.createCompilerHost(options, true);

  const processors = Processors.create({
    ts,
    configFile,
    host,
  });
  const getProcessor = (
    fileName: string,
  ): (typeof processors)[`.${string}`] | undefined => {
    const ext = getExt(fileName);
    return ext ? processors[ext] : undefined;
  };

  // Run `.marko` files through the marko -> TS extractor.
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
    const processor = getProcessor(fileName);
    if (processor) {
      const code = host.readFile(fileName);
      if (code !== undefined) {
        return ts.createSourceFile(
          fileName,
          processor.extract(fileName, code).toString(),
          languageVersion,
          true,
          processor.getScriptKind(fileName),
        );
      }
    }
    return getSourceFile(fileName, languageVersion, onError, shouldCreate);
  };

  // Teach module resolution to understand `.marko` imports.
  const moduleResolutionCache = ts.createModuleResolutionCache(
    host.getCurrentDirectory(),
    (fileName) => host.getCanonicalFileName(fileName),
    options,
  );
  host.resolveModuleNameLiterals = (literals, containingFile, redirect, opts) =>
    literals.map((literal) => {
      let moduleName = literal.text;

      // `<tag-name>` imports resolve through the Marko taglib.
      const tagNameMatch = importTagReg.exec(moduleName);
      if (tagNameMatch) {
        const tagDef = Project.getTagLookup(
          path.dirname(containingFile),
        ).getTag(tagNameMatch[1]);
        const tagFileName = tagDef && (tagDef.template || tagDef.renderer);
        if (tagFileName) moduleName = tagFileName;
      }

      const processor = getProcessor(moduleName);
      if (processor) {
        let isExternalLibraryImport = false;
        let resolvedFileName: string | undefined;
        if (fsPathReg.test(moduleName)) {
          resolvedFileName = path.resolve(containingFile, "..", moduleName);
        } else {
          // Bare package specifier: resolve the package root, then join the
          // in-package path (e.g. `@marko/runtime-tags/tags/let.d.marko`).
          const [, nodeModuleName, relativeModulePath] =
            modulePartsReg.exec(moduleName)!;
          const { resolvedModule } = ts.nodeModuleNameResolver(
            `${nodeModuleName}/package.json`,
            containingFile,
            opts,
            host,
            moduleResolutionCache,
            redirect,
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

        if (resolvedFileName) {
          if (isDefinitionFile(resolvedFileName)) {
            if (!host.fileExists(resolvedFileName)) {
              resolvedFileName = undefined;
            }
          } else {
            // Prefer a sibling `.d.marko` definition file when present.
            const ext = getExt(resolvedFileName)!;
            const definitionFile = `${resolvedFileName.slice(0, -ext.length)}.d${ext}`;
            if (host.fileExists(definitionFile)) {
              resolvedFileName = definitionFile;
            } else if (!host.fileExists(resolvedFileName)) {
              resolvedFileName = undefined;
            }
          }
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
        opts,
        host,
        moduleResolutionCache,
        redirect,
      );
    });

  // Root names: the component itself plus the ambient type roots each
  // processor contributes (the global `Marko` namespace lives there).
  const rootNames = [
    abs,
    ...Object.values(processors).flatMap(
      (processor) => processor.getRootNames?.() ?? [],
    ),
  ];

  const program = ts.createProgram({ rootNames, options, host });
  const checker = program.getTypeChecker();
  const sourceFile = program.getSourceFile(abs);
  if (!sourceFile) throw new Error(`Could not load ${abs}`);

  // Surface breakage (unresolved imports, missing Marko globals, extractor
  // bugs) instead of silently reporting an incomplete prop list.
  const diagnostics = program.getSemanticDiagnostics(sourceFile);
  if (diagnostics.length) {
    console.warn(
      ts.formatDiagnostics(diagnostics, {
        getCurrentDirectory: () => host.getCurrentDirectory(),
        getCanonicalFileName: (fileName) => host.getCanonicalFileName(fileName),
        getNewLine: () => host.getNewLine(),
      }),
    );
  }

  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
  if (!moduleSymbol) throw new Error("No module symbol (is it a module?)");

  const inputSymbol = checker
    .getExportsOfModule(moduleSymbol)
    .find((s) => s.getName() === "Input");
  if (!inputSymbol) throw new Error("No `Input` export found");

  const inputType = checker.getDeclaredTypeOfSymbol(inputSymbol);

  return (
    checker
      .getPropertiesOfType(inputType)
      // Only the component's own attributes — members inherited from library
      // types (e.g. the hundreds of attributes on `Marko.HTML.Input`) are
      // not argTypes.
      .filter((prop) =>
        prop.declarations?.some((decl) => {
          const declFile = decl.getSourceFile();
          return (
            !program.isSourceFileFromExternalLibrary(declFile) &&
            !program.isSourceFileDefaultLibrary(declFile)
          );
        }),
      )
      .map((prop) => ({
        name: prop.getName(),
        description: ts.displayPartsToString(
          prop.getDocumentationComment(checker),
        ),
        tags: prop.getJsDocTags(checker).map((t) => ({
          name: t.name,
          text: ts.displayPartsToString(t.text),
        })),
      }))
  );
}

// CLI entry (only when executed directly, not when imported as a module).
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const target = process.argv[2];
  if (!target) {
    console.error(
      "Usage: node --experimental-strip-types scripts/extract-input-jsdoc.ts <path/to/component.marko>",
    );
    process.exit(1);
  }
  const props = extractInputJsDoc(target);
  for (const p of props) {
    console.log(
      `• ${p.name}: ${p.description ? JSON.stringify(p.description) : "(no description)"}`,
    );
    for (const tag of p.tags) {
      console.log(`    @${tag.name} ${tag.text}`);
    }
  }
}
