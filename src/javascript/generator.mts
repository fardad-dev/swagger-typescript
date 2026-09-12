import {
  getPathParams,
  generateServiceName,
  getHeaderParams,
  getParametersInfo,
  getRefName,
  getSchemaName,
  getTypeNameFromRef,
  toPascalCase,
} from "./utils.mjs";
import type {
  SwaggerRequest,
  SwaggerJson,
  SwaggerResponse,
  Config,
  ApiAST,
  TypeAST,
  Schema,
  Parameter,
  ConstantsAST,
  Method,
  PathItem,
} from "../types.mjs";
import { generateApis } from "./generateApis.mjs";
import { generateTypes } from "./generateTypes.mjs";
import { generateConstants } from "./generateConstants.mjs";
import { generateHook } from "./generateHook.mjs";

type GeneratorContext = {
  apis: ApiAST[];
  types: TypeAST[];
  constants: ConstantsAST[];
  constantsCounter: number;
  input: SwaggerJson;
  config: Config;
  includeFilters: RegExp[];
  excludeFilters: RegExp[];
  /**
   * Names of the types the generated endpoints render directly, the roots
   * `removeUnusedTypes` keeps the reachable types from
   */
  rootTypeNames: Set<string>;
};

function generator(
  input: SwaggerJson,
  config: Config,
): { code: string; hooks: string; type: string } {
  const context: GeneratorContext = {
    apis: [],
    types: [],
    constants: [],
    constantsCounter: 0,
    input,
    config,
    includeFilters: (config.includes || []).map(
      (pattern) => new RegExp(pattern),
    ),
    excludeFilters: (config.excludes || []).map(
      (pattern) => new RegExp(pattern),
    ),
    rootTypeNames: new Set(),
  };

  try {
    // Process API paths
    processApiPaths(context);

    // Extract types from components
    extractComponentTypes(context);

    // Keep only the types the generated endpoints can reach
    removeUnusedTypes(context);

    // Generate final code
    let code = generateApis(context.apis, context.types, config);
    code += generateConstants(context.constants);
    const type = generateTypes(context.types, config);
    const hooks = config.reactHooks
      ? generateHook(context.apis, context.types, config)
      : "";

    return { code, hooks, type };
  } catch (error) {
    console.error({ error });
    return { code: "", hooks: "", type: "" };
  }
}

/** Get or create a constant and return its name */
function getConstantName(context: GeneratorContext, value: string): string {
  const existing = context.constants.find((c) => c.value === value);
  if (existing) {
    return existing.name;
  }

  const name = `_CONSTANT${context.constantsCounter++}`;
  context.constants.push({ name, value });
  return name;
}

/** Check if a method should be included based on filters */
function shouldIncludeMethod(
  context: GeneratorContext,
  serviceName: string,
): boolean {
  const matchesInclude =
    !context.includeFilters.length ||
    context.includeFilters.some((regex) => regex.test(serviceName));

  const matchesExclude = context.excludeFilters.some((regex) =>
    regex.test(serviceName),
  );

  return matchesInclude && !matchesExclude;
}

/** Resolve parameter references */
function resolveParameters(
  context: GeneratorContext,
  parameters?: Parameter[],
): Parameter[] | undefined {
  return parameters?.map((parameter) => {
    const { $ref } = parameter;
    if (!$ref) {
      return parameter;
    }

    const name = $ref.replace("#/components/parameters/", "");
    return {
      ...context.input.components?.parameters?.[name]!,
      $ref,
      schema: { $ref } as Schema,
    };
  });
}

/** Create query params type if needed */
function createQueryParamsType(
  context: GeneratorContext,
  serviceName: string,
  parameters?: Parameter[],
): string | false {
  const {
    exist: isQueryParamsExist,
    isNullable: isQueryParamsNullable,
    params: queryParameters,
  } = getParametersInfo(parameters, "query");

  if (!isQueryParamsExist) {
    return false;
  }

  const typeName = `${toPascalCase(serviceName)}QueryParams`;
  const properties = queryParameters?.reduce(
    (prev, { name, schema, $ref, required: _required, description }) => ({
      ...prev,
      [name]: {
        ...($ref ? { $ref } : schema),
        nullable: !_required,
        description,
      } as Schema,
    }),
    {},
  );

  context.types.push({
    name: typeName,
    schema: {
      type: "object",
      nullable: isQueryParamsNullable,
      properties,
    },
  });
  context.rootTypeNames.add(getSchemaName(typeName));

  return typeName;
}

/** Get content type from request body */
function getContentType(
  context: GeneratorContext,
  requestBody?: SwaggerRequest["requestBody"],
): string {
  const content = requestBody?.content ||
    (requestBody?.$ref &&
      context.input.components?.requestBodies?.[
        getRefName(requestBody.$ref as string)
      ]?.content) || { "application/json": null };

  return Object.keys(content)[0];
}

/** Get accept header from responses */
function getAcceptHeader(responses?: SwaggerRequest["responses"]): string {
  const content = responses?.[200]?.content || { "application/json": null };
  return Object.keys(content)[0];
}

/** Build path params reference string */
function buildPathParamsRefString(pathParams: Parameter[]): string | undefined {
  if (pathParams.length === 0) {
    return undefined;
  }

  const paramNames = pathParams.map(({ name }) => name).join(",");
  return `{${paramNames}}`;
}

/** Build Axios configuration object */
function buildAxiosConfig(
  context: GeneratorContext,
  contentType: string,
  accept: string,
  headerParams?: string,
): string {
  if (headerParams) {
    return `{
      headers:{
        ...${getConstantName(
          context,
          `{
              "Content-Type": "${contentType}",
              Accept: "${accept}",
           }`,
        )},
        ...headerParams,
      },
    }`;
  }

  return getConstantName(
    context,
    `{
        headers: {
          "Content-Type": "${contentType}",
          Accept: "${accept}",
        },
     }`,
  );
}

/** Process a single API endpoint method */
function processEndpointMethod(
  context: GeneratorContext,
  endPoint: string,
  method: string,
  options: SwaggerRequest,
  pathLevelParams?: Parameter[],
): void {
  const { operationId, security } = options;

  // Merge path-level and operation-level parameters
  const allParameters = [
    ...(pathLevelParams || []),
    ...(options.parameters || []),
  ];
  const parameters = resolveParameters(
    context,
    allParameters.length > 0 ? allParameters : undefined,
  );

  const serviceName = generateServiceName(
    endPoint,
    method,
    operationId,
    context.config,
  );

  if (!shouldIncludeMethod(context, serviceName)) {
    return;
  }

  // Extract parameters
  const pathParams = getPathParams(parameters);
  const { params: headerParams, isNullable: isHeaderParamsNullable } =
    getHeaderParams(parameters, context.config);
  const { isNullable: isQueryParamsNullable, params: queryParameters } =
    getParametersInfo(parameters, "query");

  // Create query params type
  const queryParamsTypeName = createQueryParamsType(
    context,
    serviceName,
    parameters,
  );

  // Extract body and response info
  const requestBody = getBodyContent(options.requestBody);
  const responses = getBodyContent(options.responses?.[200]);
  const contentType = getContentType(context, options.requestBody);
  const accept = getAcceptHeader(options.responses);

  // Only the parameters, the request body and the 200 response of an included
  // endpoint are rendered, so they are the roots of the used types graph
  collectRefs([parameters, requestBody, responses], context.rootTypeNames);

  // Build API object
  context.apis.push({
    contentType: contentType as ApiAST["contentType"],
    summary: options.summary,
    deprecated: options.deprecated,
    serviceName,
    queryParamsTypeName,
    pathParams,
    requestBody,
    headerParams,
    isQueryParamsNullable,
    isHeaderParamsNullable,
    responses,
    pathParamsRefString: buildPathParamsRefString(pathParams),
    endPoint,
    method: method as Method,
    security: security
      ? getConstantName(context, JSON.stringify(security))
      : "undefined",
    additionalAxiosConfig: buildAxiosConfig(
      context,
      contentType,
      accept,
      headerParams,
    ),
    queryParameters,
  });
}

/** Process all API paths */
function processApiPaths(context: GeneratorContext): void {
  Object.entries(context.input.paths).forEach(([endPoint, pathItem]) => {
    const pathLevelParams = pathItem.parameters as Parameter[] | undefined;

    Object.entries(pathItem).forEach(([method, options]) => {
      if (method === "parameters") {
        return;
      }

      processEndpointMethod(
        context,
        endPoint,
        method,
        options as SwaggerRequest,
        pathLevelParams,
      );
    });
  });
}

/** Extract types from OpenAPI components */
function extractComponentTypes(context: GeneratorContext): void {
  const { components } = context.input;

  // Extract schemas
  if (components?.schemas) {
    Object.entries(components.schemas).forEach(([name, schema]) => {
      context.types.push({ name, schema });
    });
  }

  // Extract parameters
  if (components?.parameters) {
    Object.entries(components.parameters).forEach(([key, value]) => {
      context.types.push({ ...value, name: key });
    });
  }

  // Extract request bodies
  if (components?.requestBodies) {
    Object.entries(components.requestBodies).forEach(([name, requestBody]) => {
      const schema = Object.values(requestBody.content || {})[0]?.schema;
      if (schema) {
        context.types.push({
          name: `RequestBody${name}`,
          schema,
          description: requestBody.description,
        });
      }
    });
  }
}

/**
 * Collects the name of every generated type a schema tree refers to
 *
 * Walks the whole tree, so refs nested in `properties`, `items`, `allOf`,
 * `oneOf`, `anyOf` or `additionalProperties` are all found. Beside `$ref`, the
 * targets of a `discriminator.mapping` are collected too: the subtypes of a
 * discriminated union belong to the api surface even though the base type
 * renders their discriminator values as a literal union instead of referencing
 * them.
 *
 * @param node - Any schema, parameter or array of them
 * @param refs - Set the found type names are added to
 */
function collectRefs(node: unknown, refs: Set<string>): void {
  if (!node || typeof node !== "object") {
    return;
  }

  if (Array.isArray(node)) {
    node.forEach((item) => collectRefs(item, refs));
    return;
  }

  Object.entries(node as Record<string, unknown>).forEach(([key, value]) => {
    if (key === "$ref") {
      if (typeof value === "string") {
        refs.add(getTypeNameFromRef(value));
      }
      return;
    }

    // Subtypes of a discriminated union are part of the api surface even though
    // nothing references them by $ref
    if (key === "discriminator") {
      const mapping = (value as Schema["discriminator"])?.mapping;
      if (mapping) {
        Object.values(mapping).forEach((ref) =>
          refs.add(getTypeNameFromRef(ref)),
        );
      }
      return;
    }

    collectRefs(value, refs);
  });
}

/**
 * Drops the types no generated endpoint can reach
 *
 * A document usually defines far more components than the generated endpoints
 * use, and `includes`/`excludes` filters make the gap bigger. Starting from
 * `context.rootTypeNames` - the types the generated endpoints render directly -
 * every reachable type is collected by following the refs of the types already
 * kept, then `context.types` is reduced to that set.
 *
 * The result stays self contained: a kept type can only refer to types which
 * are kept as well.
 *
 * @param context - Generator context, its `types` are filtered in place
 */
function removeUnusedTypes(context: GeneratorContext): void {
  const typesByName = new Map<string, TypeAST[]>();
  context.types.forEach((type) => {
    const name = getSchemaName(type.name);
    typesByName.set(name, [...(typesByName.get(name) || []), type]);
  });

  const usedTypeNames = new Set<string>();
  const pendingTypeNames = [...context.rootTypeNames];

  while (pendingTypeNames.length) {
    const name = pendingTypeNames.pop()!;
    if (usedTypeNames.has(name)) {
      continue;
    }
    usedTypeNames.add(name);

    const refs = new Set<string>();
    typesByName.get(name)?.forEach((type) => collectRefs(type, refs));
    refs.forEach((ref) => {
      if (!usedTypeNames.has(ref)) {
        pendingTypeNames.push(ref);
      }
    });
  }

  context.types = context.types.filter(({ name }) =>
    usedTypeNames.has(getSchemaName(name)),
  );
}

/** Extract body content from response or request body */
function getBodyContent(responses?: SwaggerResponse): Schema | undefined {
  if (!responses) {
    return undefined;
  }

  if (responses.content) {
    return Object.values(responses.content)[0].schema;
  }

  if (responses.$ref) {
    return { $ref: responses.$ref } as Schema;
  }

  return undefined;
}

export { generator };
