/**
 * Node-only docgen for Marko components: reads docs from the exported `Input`
 * type through the TypeScript checker (via the optional `typescript` peer)
 * into react-docgen shaped `__docgenInfo`.
 */
import path from "node:path";

import type TS from "typescript";

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
  /** Stands in for every attribute of an inherited external type. */
  rest?: true;
}

export interface DocgenInfo {
  displayName: string;
  description: string;
  props: Record<string, DocgenProp>;
}

export interface DocgenResult {
  /** `code` with `__docgenInfo` attached; existing positions are unchanged. */
  code: string;
  /** In-project files the docs were read from, to watch for changes. */
  dependencies: string[];
}

interface MarkoDocgen {
  getDocgenInfo(
    fileName: string,
  ): { info: DocgenInfo; dependencies: Set<string> } | undefined;
}

interface Tools {
  ts: typeof TS;
  Processors: LanguageTools["Processors"];
  Project: LanguageTools["Project"];
}

const fsPathReg = /^(?:[./\\]|[A-Z]:)/i;
const importTagReg = /^<([^>]+)>$/;
const nodeModulesReg = /[\\/]node_modules[\\/]/;
// Replaces `export default` with the same length so source maps stay valid.
const exportDefault = "export default";
const namedDefault = "const __dg =".padEnd(exportDefault.length);
const nativeTagReg = /^(?:global\.)?Marko\.HTML\.(\w+)$/;
const nativeInputReg = /^(?:global\.)?Marko\.Input<\s*["'](\w+)["']\s*>$/;
const utilityTypeReg = /^(?:Omit|Pick|Partial|Required|Readonly)$/;
const warned = new Set<string>();
const docgens = new Map<string, MarkoDocgen>();
let toolsPromise: Promise<Tools | undefined> | undefined;

/**
 * Appends a `__docgenInfo` assignment for `fileName` onto its compiled `code`,
 * or returns undefined when there is nothing to attach. Never throws: docs are
 * best effort, so a failure warns once per file and leaves `code` alone.
 */
export async function withDocgenInfo(
  code: string,
  fileName: string,
): Promise<DocgenResult | undefined> {
  fileName = path.resolve(fileName);
  if (nodeModulesReg.test(fileName)) return;
  try {
    const tools = await (toolsPromise ??= loadTools());
    const result =
      tools && getMarkoDocgen(tools, fileName)?.getDocgenInfo(fileName);
    if (!result || !Object.keys(result.info.props).length) return;
    const { ts } = tools;
    const sourceFile = ts.createSourceFile(
      fileName,
      code,
      ts.ScriptTarget.Latest,
    );
    const start = sourceFile.statements
      .find(
        (statement) =>
          ts.isExportAssignment(statement) && !statement.isExportEquals,
      )
      ?.getStart(sourceFile);
    if (start === undefined || !code.startsWith(exportDefault, start)) return;
    return {
      code: `${code.slice(0, start)}${namedDefault}${code.slice(
        start + exportDefault.length,
      )}\nexport default __dg;\n__dg.__docgenInfo = ${JSON.stringify(result.info)};\n`,
      dependencies: [...result.dependencies],
    };
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

async function loadTools(): Promise<Tools | undefined> {
  try {
    const [{ default: ts }, { Processors, Project }] = await Promise.all([
      import("typescript"),
      import("@marko/language-tools"),
    ]);
    return { ts, Processors, Project };
  } catch {
    return undefined;
  }
}

/** One docgen per tsconfig, found from the component like an editor would. */
function getMarkoDocgen(tools: Tools, fileName: string) {
  const { ts } = tools;
  const host = ts.sys;
  const fileDir = path.dirname(fileName);
  const configFile =
    ts.findConfigFile(fileDir, host.fileExists, "tsconfig.json") ||
    ts.findConfigFile(fileDir, host.fileExists, "jsconfig.json");
  const key = configFile || "";
  let docgen = docgens.get(key);
  if (!docgen) {
    docgen = createMarkoDocgen(
      tools,
      configFile,
      configFile ? path.dirname(configFile) : host.getCurrentDirectory(),
    );
    docgens.set(key, docgen);
  }
  return docgen;
}

function createMarkoDocgen(
  { ts, Processors, Project }: Tools,
  configFile: string | undefined,
  dir: string,
): MarkoDocgen {
  const host = ts.sys;
  const processors = Processors.create({ ts, host, configFile });
  const getProcessor = (fileName: string) => {
    const ext = Processors.getProcessorExtension(fileName);
    return ext ? processors[ext] : undefined;
  };

  // Start from every file the config includes, as an editor would, so that
  // components share one program rather than each rebuilding it.
  const parsedConfig = configFile
    ? ts.getParsedCommandLineOfConfigFile(
        configFile,
        undefined,
        { ...host, onUnRecoverableConfigFileDiagnostic() {} },
        undefined,
        undefined,
        Object.keys(processors).map((extension) => ({
          extension,
          isMixedContent: false,
          scriptKind: ts.ScriptKind.Deferred,
        })),
      )
    : undefined;
  const compilerOptions: TS.CompilerOptions = {
    ...parsedConfig?.options,
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

  // The processors' roots are Marko's own type libraries.
  const typeLibNames = new Set<string>();
  for (const ext in processors) {
    for (const rootName of processors[
      ext as keyof typeof processors
    ].getRootNames?.() || []) {
      typeLibNames.add(rootName);
    }
  }
  const rootNames = new Set([
    ...typeLibNames,
    ...(parsedConfig?.fileNames || []),
  ]);

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

      const extractor = new InputExtractor(ts, program!, typeLibNames);
      const props = extractor.props(
        checker!.getDeclaredTypeOfSymbol(inputSymbol),
        sourceFile,
        inputSymbol.declarations || [],
      );
      extractor.dependencies.delete(fileName);
      const basename = path.basename(fileName, ".marko");
      return {
        info: {
          displayName:
            basename === "index"
              ? path.basename(path.dirname(fileName))
              : basename,
          description: ts.displayPartsToString(
            inputSymbol.getDocumentationComment(checker!),
          ),
          props,
        },
        dependencies: extractor.dependencies,
      };
    },
  };
}

/** Reads the docs of one `Input` type, tracking the in-project files used. */
class InputExtractor {
  readonly dependencies = new Set<string>();
  private readonly checker: TS.TypeChecker;
  /** Attr tag types being expanded, so recursive ones stop. */
  private readonly expanding = new Set<TS.Type>();

  constructor(
    private readonly ts: typeof TS,
    private readonly program: TS.Program,
    private readonly typeLibNames: Set<string>,
  ) {
    this.checker = program.getTypeChecker();
  }

  /**
   * The props of `type`. `baseNodes` are the declarations it was written as,
   * used to name the external types it inherits from.
   */
  props(
    type: TS.Type,
    fallbackLocation: TS.Node,
    baseNodes: readonly TS.Node[],
  ): Record<string, DocgenProp> {
    const { ts, checker } = this;
    const props: Record<string, DocgenProp> = {};
    for (const prop of checker.getPropertiesOfType(type)) {
      // Docs come only from in-project declarations, so inherited native
      // attributes (eg `Input extends Marko.HTML.Input`) are summarized by
      // `externalBases` rather than listed, and re-declared ones don't pick up
      // the lib's docs unless asked to with `@inheritDoc`.
      const declarations = new Set(
        prop.declarations?.filter((decl) => !this.isExternal(decl)),
      );
      if (prop.declarations?.length && !declarations.size) continue;

      const descriptions = new Set<string>();
      let defaultValue: { value: string } | undefined;
      let inheritDoc = false;
      for (const decl of declarations) {
        this.dependencies.add(decl.getSourceFile().fileName);
        for (const text of this.jsDocComments(decl)) descriptions.add(text);
        for (const tag of ts.getJSDocTags(decl)) {
          const name = tag.tagName.text;
          const text = ts.getTextOfJSDocComment(tag.comment) ?? "";
          if (name === "default" || name === "defaultValue") {
            defaultValue = { value: text };
          } else if (name.toLowerCase() === "inheritdoc") {
            inheritDoc = true;
          } else {
            // docs-tools parses remaining tags (eg @deprecated) back out.
            descriptions.add(`@${name}${text ? ` ${text}` : ""}`);
          }
        }
      }
      if (inheritDoc) {
        for (const decl of this.inheritedDeclarations(type, prop.name)) {
          if (declarations.has(decl)) continue;
          for (const text of this.jsDocComments(decl)) descriptions.add(text);
        }
      }

      const location = prop.valueDeclaration || prop.declarations?.[0];
      const propType = checker.getTypeOfSymbolAtLocation(
        prop,
        location || fallbackLocation,
      );
      const attrTagType = this.attrTagType(propType);
      const declaredType =
        location && ts.isPropertySignature(location)
          ? location.type
          : undefined;
      let nested: Record<string, DocgenProp> | undefined;
      if (attrTagType && !this.expanding.has(attrTagType)) {
        this.expanding.add(attrTagType);
        const argNode = declaredType && this.attrTagArgNode(declaredType);
        nested = this.props(
          attrTagType,
          location || fallbackLocation,
          argNode ? [argNode] : [],
        );
        this.expanding.delete(attrTagType);
      }
      props[prop.name] = {
        description: [...descriptions].join("\n"),
        required: !(prop.flags & ts.SymbolFlags.Optional),
        tsType:
          attrTagType && !(propType.isUnion() && this.isMixedUnion(propType))
            ? { name: "AttrTag" }
            : this.tsTypeOf(propType, declaredType),
        ...(defaultValue && { defaultValue }),
        ...(attrTagType && { "@": nested || {} }),
      };
    }
    // A union itself only exposes props common to every member; merge
    // member-only props in as optional.
    if (type.isUnion()) {
      for (const member of type.types) {
        const memberProps = this.props(member, fallbackLocation, []);
        for (const name in memberProps) {
          if (!(name in props)) {
            props[name] = { ...memberProps[name], required: false };
          }
        }
      }
    }
    Object.assign(props, this.externalBases(baseNodes));
    return props;
  }

  private isExternal(node: TS.Node) {
    const sourceFile = node.getSourceFile();
    return (
      this.program.isSourceFileDefaultLibrary(sourceFile) ||
      this.program.isSourceFileFromExternalLibrary(sourceFile) ||
      this.typeLibNames.has(sourceFile.fileName)
    );
  }

  private jsDocComments(decl: TS.Node) {
    const { ts } = this;
    const texts: string[] = [];
    for (const jsDoc of ts.getJSDocCommentsAndTags(decl)) {
      if (!ts.isJSDoc(jsDoc)) continue;
      const text = ts.getTextOfJSDocComment(jsDoc.comment);
      if (text) texts.push(text);
    }
    return texts;
  }

  /** The declarations a re-declared prop overrides, for `@inheritDoc`. */
  private inheritedDeclarations(type: TS.Type, name: string) {
    const { ts, checker } = this;
    const bases = type.isIntersection()
      ? type.types
      : type.flags & ts.TypeFlags.Object &&
          (type as TS.ObjectType).objectFlags & ts.ObjectFlags.ClassOrInterface
        ? checker.getBaseTypes(type as TS.InterfaceType)
        : [];
    return bases.flatMap(
      (base) => checker.getPropertyOfType(base, name)?.declarations || [],
    );
  }

  /**
   * The `T & {...}` of a `Marko.AttrTag<T>` (also when aliased, or in a
   * union), recognized by its marker type literal from Marko's own types so
   * that it works whatever the configured lib.
   */
  private attrTagType(type: TS.Type): TS.Type | undefined {
    if (type.isUnion()) {
      return type.types.map((member) => this.attrTagType(member)).find(Boolean);
    }
    if (
      type.isIntersection() &&
      type.types.some((t) => this.isAttrTagMarker(t))
    )
      return type;
  }

  private isAttrTagMarker(type: TS.Type) {
    const { ts } = this;
    const decl = type.getSymbol()?.declarations?.[0];
    if (!decl || !ts.isTypeLiteralNode(decl) || !this.isExternal(decl))
      return false;
    let node = decl.parent;
    while (ts.isIntersectionTypeNode(node) || ts.isParenthesizedTypeNode(node))
      node = node.parent;
    return ts.isTypeAliasDeclaration(node) && node.name.text === "AttrTag";
  }

  /** Whether a union holds more than an attr tag (and `undefined`). */
  private isMixedUnion(type: TS.UnionType) {
    return type.types.some(
      (member) =>
        !(member.flags & this.ts.TypeFlags.Undefined) &&
        !this.attrTagType(member),
    );
  }

  /** The written `T` of a `Marko.AttrTag<T>` annotation. */
  private attrTagArgNode(node: TS.TypeNode): TS.TypeNode | undefined {
    const { ts } = this;
    if (ts.isUnionTypeNode(node)) {
      return node.types.map((t) => this.attrTagArgNode(t)).find(Boolean);
    }
    if (ts.isParenthesizedTypeNode(node)) return this.attrTagArgNode(node.type);
    if (!ts.isTypeReferenceNode(node)) return;
    const decl = this.resolveDeclaration(node.typeName);
    if (!decl || !ts.isTypeAliasDeclaration(decl)) return;
    if (this.isExternal(decl)) {
      return decl.name.text === "AttrTag" ? node.typeArguments?.[0] : undefined;
    }
    return this.attrTagArgNode(decl.type);
  }

  private resolveDeclaration(name: TS.Node) {
    const { ts, checker } = this;
    let symbol = checker.getSymbolAtLocation(name);
    if (symbol && symbol.flags & ts.SymbolFlags.Alias) {
      symbol = checker.getAliasedSymbol(symbol);
    }
    return symbol?.declarations?.[0];
  }

  /**
   * One `rest` row per external type the written declarations inherit from,
   * eg `...Marko.HTML.Span` for `Input extends Omit<Marko.HTML.Span, "role">`,
   * in place of the attributes left out of the table.
   */
  private externalBases(nodes: readonly TS.Node[]) {
    const { ts, checker } = this;
    const rows: Record<string, DocgenProp> = {};
    const visited = new Set<TS.Node>();
    // `omitted` holds the keys an enclosing `Omit<Local, ...>` removes.
    const visit = (node: TS.Node, omitted: readonly string[]): void => {
      if (visited.has(node)) return;
      visited.add(node);
      if (ts.isInterfaceDeclaration(node)) {
        this.dependencies.add(node.getSourceFile().fileName);
        for (const clause of node.heritageClauses || []) {
          for (const base of clause.types) visit(base, omitted);
        }
      } else if (ts.isTypeAliasDeclaration(node)) {
        this.dependencies.add(node.getSourceFile().fileName);
        visit(node.type, omitted);
      } else if (ts.isIntersectionTypeNode(node)) {
        for (const member of node.types) visit(member, omitted);
      } else if (ts.isParenthesizedTypeNode(node)) {
        visit(node.type, omitted);
      } else if (
        ts.isTypeReferenceNode(node) ||
        ts.isExpressionWithTypeArguments(node)
      ) {
        const decl = this.resolveDeclaration(
          ts.isTypeReferenceNode(node) ? node.typeName : node.expression,
        );
        if (decl && !this.isExternal(decl)) {
          if (
            ts.isInterfaceDeclaration(decl) ||
            ts.isTypeAliasDeclaration(decl)
          )
            visit(decl, omitted);
          return;
        }
        const utility = this.utilityOf(node);
        if (utility) {
          const [arg, keys] = node.typeArguments!;
          const argDecl =
            ts.isTypeReferenceNode(arg) &&
            this.resolveDeclaration(arg.typeName);
          // See through utilities on in-project types to what they inherit.
          if (argDecl && !this.isExternal(argDecl)) {
            if (utility !== "Pick") {
              visit(
                arg,
                utility === "Omit" && keys
                  ? [...omitted, ...this.stringLiterals(keys)]
                  : omitted,
              );
            }
            return;
          }
        }
        const type = checker.getTypeAtLocation(node);
        const props = checker.getPropertiesOfType(type);
        if (
          !props.length ||
          !props.every((prop) =>
            prop.declarations?.every((d) => this.isExternal(d)),
          )
        )
          return;
        const [name, row] = this.restRow(
          node,
          omitted.filter((key) => checker.getPropertyOfType(type, key)),
        );
        rows[name] = row;
      }
    };
    for (const node of nodes) visit(node, []);
    return rows;
  }

  /** The lib utility type (eg `Omit`) a reference applies, if any. */
  private utilityOf(
    node: TS.TypeReferenceNode | TS.ExpressionWithTypeArguments,
  ) {
    const name = (
      this.ts.isTypeReferenceNode(node) ? node.typeName : node.expression
    ).getText();
    return node.typeArguments?.length && utilityTypeReg.test(name)
      ? name
      : undefined;
  }

  /** The keys an `Omit` removes, with patterns like `on${string}` as `on*`. */
  private stringLiterals(node: TS.TypeNode): string[] {
    // Walk a written union so the keys keep the order they were written in.
    if (this.ts.isUnionTypeNode(node)) {
      return node.types.flatMap((member) => this.stringLiterals(member));
    }
    const type = this.checker.getTypeAtLocation(node);
    return (type.isUnion() ? type.types : [type]).flatMap((t) =>
      t.isStringLiteral()
        ? [t.value]
        : t.flags & this.ts.TypeFlags.TemplateLiteral
          ? [(t as TS.TemplateLiteralType).texts.join("*")]
          : [],
    );
  }

  private restRow(
    node: TS.TypeReferenceNode | TS.ExpressionWithTypeArguments,
    omitted: readonly string[],
  ): [string, DocgenProp] {
    const utility = this.utilityOf(node);
    const [arg, keys] = node.typeArguments || [];
    // See through the lib's utility types to the type they modify.
    const typeName = utility ? arg.getText() : node.getText();
    const except = [
      ...omitted,
      ...(utility === "Omit" && keys ? this.stringLiterals(keys) : []),
    ];
    const nativeTag =
      nativeTagReg.exec(typeName)?.[1].toLowerCase() ||
      nativeInputReg.exec(typeName)?.[1];
    const exceptText = except.length
      ? `, except ${except.map((key) => `\`${key}\``).join(", ")}`
      : "";
    return [
      `...${typeName}`,
      {
        description: nativeTag
          ? `Also accepts the attributes and event handlers of the native [\`<${nativeTag}>\` tag](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/${nativeTag})${exceptText}.`
          : `Also accepts the members of \`${typeName}\`${exceptText}.`,
        required: false,
        tsType: { name: node.getText() },
        rest: true,
      },
    ];
  }

  /**
   * The type for controls, displayed (`raw`) as written where there is an
   * annotation, like react-docgen does, else as the checker prints it.
   */
  private tsTypeOf(type: TS.Type, written?: TS.TypeNode): DocgenTsType {
    const tsType = this.convert(type);
    return {
      ...tsType,
      raw: written?.getText().replace(/\s+/g, " ") ?? tsType.raw,
    };
  }

  private convert(type: TS.Type): DocgenTsType & { raw: string } {
    const { ts, checker } = this;
    if (type.isUnion()) {
      const elements: (DocgenTsType & { raw: string })[] = [];
      const boolLiterals: string[] = [];
      for (const member of type.types) {
        if (member.flags & ts.TypeFlags.Undefined) continue;
        if (member.flags & ts.TypeFlags.BooleanLiteral) {
          boolLiterals.push(checker.typeToString(member));
        } else {
          elements.push(this.convert(member));
        }
      }
      // The checker expands `boolean` to `true | false`; fold it back.
      if (boolLiterals.length === 2) {
        elements.push({ name: "boolean", raw: "boolean" });
      } else {
        for (const value of boolLiterals) {
          elements.push({ name: "literal", value, raw: value });
        }
      }
      if (elements.length === 1) return elements[0];
      const raw = elements.map((element) => element.raw).join(" | ");
      // Eg a handler typed differently by each member of a union `Input`.
      if (elements.every((element) => element.type === "function")) {
        return { name: "signature", type: "function", raw };
      }
      return { name: "union", raw, elements };
    }
    const raw = checker.typeToString(type);
    if (type.isStringLiteral() || type.isNumberLiteral()) {
      return { name: "literal", value: raw, raw };
    }
    if (type.getCallSignatures().length) {
      return { name: "signature", type: "function", raw };
    }
    return { name: raw, raw };
  }
}
