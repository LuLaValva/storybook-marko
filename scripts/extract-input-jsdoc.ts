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
import crypto from "node:crypto";
import path from "node:path";
import ts from "typescript/lib/tsserverlibrary.js";
import { Processors, getExt } from "@marko/language-tools";

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
    noEmit: true,
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
  const getProcessor = (fileName: string) => {
    const ext = getExt(fileName);
    return ext ? processors[ext as `.${string}`] : undefined;
  };

  // TS won't accept a `.marko` file as a root name (unknown extension), so we
  // feed it a virtual `.ts` entry that imports the component; the `.marko`
  // file then loads via module resolution (overridden below).
  const entryFile = path.join(path.dirname(abs), `__sb_input_probe__.ts`);
  const entryCode = `import { Input } from ${JSON.stringify(abs)};\nexport type _ = Input;\n`;

  // Run `.marko` files through the marko -> TS extractor.
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
    if (fileName === entryFile) {
      return ts.createSourceFile(
        fileName,
        entryCode,
        languageVersion,
        true,
        ts.ScriptKind.TS,
      );
    }
    const processor = getProcessor(fileName);
    if (processor) {
      const code = host.readFile(fileName);
      if (code !== undefined) {
        const extracted = processor.extract(fileName, code);
        const extractedCode = extracted.toString();
        const sf = ts.createSourceFile(
          fileName,
          extractedCode,
          languageVersion,
          true,
          processor.getScriptKind(fileName),
        );
        // @ts-expect-error internal version field used by TS
        sf.version = crypto
          .createHash("md5")
          .update(extractedCode)
          .digest("hex");
        return sf;
      }
    }
    return getSourceFile(fileName, languageVersion, onError, shouldCreate);
  };

  // Teach module resolution to understand `.marko` imports.
  host.resolveModuleNameLiterals = (
    literals,
    containingFile,
    _redirect,
    opts,
  ) =>
    literals.map((literal) => {
      const text = literal.text;
      if (text.endsWith(".marko")) {
        const resolvedFileName = path.resolve(
          path.dirname(containingFile),
          text,
        );
        if (host.fileExists(resolvedFileName)) {
          const processor = getProcessor(resolvedFileName);
          return {
            resolvedModule: {
              resolvedFileName,
              extension: processor!.getScriptExtension(resolvedFileName),
              isExternalLibraryImport: false,
            },
          };
        }
      }
      return ts.bundlerModuleNameResolver(
        text,
        containingFile,
        opts,
        host,
        undefined,
      );
    });

  const fileExists = host.fileExists.bind(host);
  host.fileExists = (f) => f === entryFile || fileExists(f);

  const program = ts.createProgram({ rootNames: [entryFile], options, host });
  const checker = program.getTypeChecker();
  const sourceFile = program.getSourceFile(abs);
  if (!sourceFile) throw new Error(`Could not load ${abs}`);

  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
  if (!moduleSymbol) throw new Error("No module symbol (is it a module?)");

  const inputSymbol = checker
    .getExportsOfModule(moduleSymbol)
    .find((s) => s.getName() === "Input");
  if (!inputSymbol) throw new Error("No `Input` export found");

  const inputType = checker.getDeclaredTypeOfSymbol(inputSymbol);

  return checker.getPropertiesOfType(inputType).map((prop) => ({
    name: prop.getName(),
    description: ts.displayPartsToString(prop.getDocumentationComment(checker)),
    tags: prop.getJsDocTags(checker).map((t) => ({
      name: t.name,
      text: ts.displayPartsToString(t.text),
    })),
  }));
}

// CLI entry
const target = process.argv[2];
if (target) {
  const props = extractInputJsDoc(target);
  for (const p of props) {
    console.log(
      `• ${p.name}: ${JSON.stringify(p.description) || "(no description)"}`,
    );
    for (const tag of p.tags) {
      console.log(`    @${tag.name} ${tag.text}`);
    }
  }
}
