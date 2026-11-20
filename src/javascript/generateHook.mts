import {
  getTsType,
  getDefineParam,
  getParamString,
  toPascalCase,
  getSchemaName,
} from "./utils.mjs";
import { ApiAST, Config, TypeAST } from "../types.mjs";
import {
  DEPRECATED_WARM_MESSAGE,
  getHooksFunctions,
  getHooksImports,
} from "./strings.mjs";
import { getJsdoc } from "../utilities/jsdoc.mjs";
import { isAscending, isMatchWholeWord } from "../utils.mjs";

const ALLOWED_PAGE_PARAM_NAMES = ["page", "pageno", "pagenumber", "offset"];

type HookContext = {
  config: Config;
  hasInfiniteQuery: boolean;
  /** Set while generating, so the suspense imports are only emitted when used */
  hasSuspenseQuery: boolean;
  hasSuspenseInfiniteQuery: boolean;
  hasMutationWithoutVariables: boolean;
};

function generateHook(
  apis: ApiAST[],
  types: TypeAST[],
  config: Config,
): string {
  try {
    const context: HookContext = {
      config,
      hasInfiniteQuery: !!config.useInfiniteQuery?.length,
      hasSuspenseQuery: false,
      hasSuspenseInfiniteQuery: false,
      hasMutationWithoutVariables: false,
    };

    const sortedApis = apis.sort(({ serviceName }, { serviceName: other }) =>
      isAscending(serviceName, other),
    );

    const apisCode = sortedApis
      .map((api) => generateSingleHook(api, context))
      .join("\n");

    return buildFinalCode(apisCode, types, sortedApis, context);
  } catch (error) {
    console.error(error);
    return "";
  }
}

/** Generate code for a single hook */
function generateSingleHook(api: ApiAST, context: HookContext): string {
  const hookName = `use${toPascalCase(api.serviceName)}`;
  const isInfiniteQuery = shouldUseInfiniteQuery(api, hookName, context);
  const isSuspenseQuery = shouldUseSuspenseQuery(api, hookName, context);
  const isQuery =
    isInfiniteQuery ||
    isSuspenseQuery ||
    shouldUseQuery(api, hookName, context);

  if (isSuspenseQuery && isInfiniteQuery) {
    context.hasSuspenseInfiniteQuery = true;
  } else if (isSuspenseQuery) {
    context.hasSuspenseQuery = true;
  }

  const hookConfig = buildHookConfig(
    api,
    isQuery,
    isInfiniteQuery,
    isSuspenseQuery,
    context,
  );

  let code = generateHookJsDoc(api);
  code += generateHookSignature(hookName, isQuery, hookConfig);
  code += generateHookBody(api, hookName, isQuery, isInfiniteQuery, hookConfig);

  if (isQuery) {
    code += generateInfoMethod(api, hookName, isInfiniteQuery, hookConfig);
    code += generatePrefetchMethod(api, hookName, hookConfig);
  }

  return code;
}

/** Build configuration object for hook generation */
function buildHookConfig(
  api: ApiAST,
  isQuery: boolean,
  isInfiniteQuery: boolean,
  isSuspenseQuery: boolean,
  context: HookContext,
) {
  const TData = api.responses
    ? getTsType(api.responses, context.config)
    : "any";
  const TQueryFnData = `SwaggerResponse<${TData}>`;
  const TError = "RequestError | Error";

  return {
    api,
    isQuery,
    isInfiniteQuery,
    isSuspenseQuery,
    TData,
    TQueryFnData,
    TError,
    paramsString: buildParamsString(api, false),
    paramsStringOverride: buildParamsString(api, isInfiniteQuery),
    queryKey: buildQueryKey(api),
    variables: buildVariables(api, context),
    params: buildHookParams(
      api,
      isQuery,
      isInfiniteQuery,
      isSuspenseQuery,
      TData,
      context,
    ),
  };
}

/**
 * Check if a config list names this endpoint, by service name or hook name
 * (case insensitive)
 */
function isListed(
  names: string[] | undefined,
  api: ApiAST,
  hookName: string,
): boolean {
  return !!names?.find(
    (name) =>
      name.toLowerCase() === api.serviceName.toLowerCase() ||
      name.toLowerCase() === hookName.toLowerCase(),
  );
}

/** Check if hook should use infinite query */
function shouldUseInfiniteQuery(
  api: ApiAST,
  hookName: string,
  context: HookContext,
): boolean {
  return isListed(context.config.useInfiniteQuery, api, hookName);
}

/** Check if hook should use the suspense variant of its query hook */
function shouldUseSuspenseQuery(
  api: ApiAST,
  hookName: string,
  context: HookContext,
): boolean {
  return isListed(context.config.useSuspenseQuery, api, hookName);
}

/** Check if hook should use query (not mutation) */
function shouldUseQuery(
  api: ApiAST,
  hookName: string,
  context: HookContext,
): boolean {
  if (api.method === "get") {
    return true;
  }

  return isListed(context.config.useQuery, api, hookName);
}

/** Build params string for function calls */
function buildParamsString(api: ApiAST, usePageParam: boolean): string {
  const parts: string[] = [];

  if (api.pathParams.length) {
    parts.push(api.pathParams.map(({ name }) => name).join(","));
  }

  if (api.requestBody) {
    parts.push("requestBody");
  }

  if (api.queryParamsTypeName) {
    if (usePageParam) {
      parts.push("{ ..._param, ...queryParams }");
    } else {
      parts.push("queryParams");
    }
  }

  if (api.headerParams) {
    parts.push("headerParams");
  }

  return parts.join(", ");
}

/** Build query key array */
function buildQueryKey(api: ApiAST): string {
  const parts = [`${api.serviceName}.key`];

  if (api.pathParams.length) {
    parts.push(...api.pathParams.map(({ name }) => name));
  }

  if (api.requestBody) {
    parts.push("requestBody");
  }

  if (api.queryParamsTypeName) {
    parts.push("queryParams");
  }

  if (api.headerParams) {
    parts.push("headerParams");
  }

  // Appended last so the generated key stays a prefix of the extended one,
  // which keeps prefix-based invalidation matching both.
  parts.push("...(extraQueryKey || [])");

  return `[${parts.join(", ")}]`;
}

/** Build TypeScript variables type string */
function buildVariables(api: ApiAST, context: HookContext): string {
  const parts: string[] = [];

  // Path parameters
  api.pathParams.forEach(({ name, required, schema, description }) => {
    parts.push(
      getDefineParam(name, required, schema, context.config, description),
    );
  });

  // Request body
  if (api.requestBody) {
    parts.push(
      getDefineParam("requestBody", true, api.requestBody, context.config),
    );
  }

  // Query parameters
  if (api.queryParamsTypeName) {
    parts.push(
      getParamString(
        "queryParams",
        !api.isQueryParamsNullable,
        api.queryParamsTypeName,
      ),
    );
  }

  // Header parameters
  if (api.headerParams) {
    parts.push(
      getParamString(
        "headerParams",
        !api.isHeaderParamsNullable,
        api.headerParams as string,
      ),
    );
  }

  return parts.join(", ");
}

/** Build hook parameters for function signature */
function buildHookParams(
  api: ApiAST,
  isQuery: boolean,
  isInfiniteQuery: boolean,
  isSuspenseQuery: boolean,
  TData: string,
  context: HookContext,
): string[] {
  const params: string[] = [];
  const signatureContext: HookContext = { ...context, config: {} as Config };

  if (isQuery) {
    const variables = buildVariables(api, signatureContext);
    if (variables.length > 0) {
      params.push(variables);
    }
  }

  // Options parameter
  let optionsType: string;
  if (isInfiniteQuery) {
    optionsType = isSuspenseQuery
      ? `SwaggerTypescriptUseSuspenseInfiniteQueryOptions<${TData}>`
      : `SwaggerTypescriptUseInfiniteQueryOptions<${TData}>`;
  } else if (isSuspenseQuery) {
    optionsType = `SwaggerTypescriptUseSuspenseQueryOptions<${TData}>`;
  } else if (isQuery) {
    optionsType = `SwaggerTypescriptUseQueryOptions<${TData}>`;
  } else {
    const variables = buildVariables(api, signatureContext);
    if (variables?.length > 0) {
      optionsType = `SwaggerTypescriptUseMutationOptions<${TData}, {${variables}}, TExtra>`;
    } else {
      // Mark that we need the void mutation type
      context.hasMutationWithoutVariables = true;
      optionsType = `SwaggerTypescriptUseMutationOptionsVoid<${TData}, TExtra>`;
    }
  }
  params.push(`options?: ${optionsType}`);

  if (isQuery) {
    params.push("configOverride?: AxiosRequestConfig");
  }

  return params;
}

/** Generate JSDoc for hook */
function generateHookJsDoc(api: ApiAST): string {
  return getJsdoc({
    description: api.summary,
    deprecated: api.deprecated ? DEPRECATED_WARM_MESSAGE : undefined,
  });
}

/** Generate hook function signature */
function generateHookSignature(
  hookName: string,
  isQuery: boolean,
  config: any,
): string {
  const generic = isQuery ? "" : "<TExtra>";
  const params = config.params.join(", ");
  return `export const ${hookName} =${generic} (${params}) => {`;
}

/** Generate hook body */
function generateHookBody(
  api: ApiAST,
  hookName: string,
  isQuery: boolean,
  isInfiniteQuery: boolean,
  config: any,
): string {
  if (isQuery) {
    return generateQueryHookBody(api, hookName, isInfiniteQuery, config);
  }
  return generateMutationHookBody(api, config);
}

/** Generate query hook body */
function generateQueryHookBody(
  api: ApiAST,
  hookName: string,
  isInfiniteQuery: boolean,
  config: any,
): string {
  let code = `
    const { extraQueryKey, ...queryOptions } = options || {};
    const { key, fun } = ${hookName}.info(${
      config.paramsString ? `${config.paramsString}, ` : ""
    }configOverride, extraQueryKey);
  `;

  if (isInfiniteQuery) {
    const pageParam = findPageParameter(api);
    code += `
      const {
        data: { pages } = {},
        data,
        ...rest
      } = ${
        config.isSuspenseQuery ? "useSuspenseInfiniteQuery" : "useInfiniteQuery"
      }({
        queryKey: key,
        queryFn: ({ pageParam }) => fun({ ${pageParam}: pageParam }),
        initialPageParam: 1,
        getNextPageParam: (_lastPage, allPages) => allPages.length + 1,
        ...(queryOptions as any),
      });

      const list = useMemo(() => paginationFlattenData(pages), [pages]);
      const total = getTotal(pages);
      const hasMore = useHasMore(pages, list, queryParams);
      
      return { ...rest, data, list, hasMore, total };
    `;
  } else {
    code += `
      return ${config.isSuspenseQuery ? "useSuspenseQuery" : "useQuery"}({
        queryKey: key,
        queryFn: fun,
        ...queryOptions
      });
    `;
  }

  code += "};";
  return code;
}

/** Generate mutation hook body */
function generateMutationHookBody(api: ApiAST, config: any): string {
  return `
    return useMutation({
      mutationFn: (_o) => {
        const { ${
          config.paramsString ? `${config.paramsString},` : ""
        }configOverride } = _o || {};
        return ${api.serviceName}(${
          config.paramsString ? `${config.paramsString},` : ""
        }configOverride);
      },
      ...options
    });
  };`;
}

/** Find page parameter name from query parameters */
function findPageParameter(api: ApiAST): string {
  const param = api.queryParameters?.find(({ name }) =>
    ALLOWED_PAGE_PARAM_NAMES.includes(name.toLowerCase()),
  );
  return param?.name || "page";
}

/** Generate info method for query hooks */
function generateInfoMethod(
  api: ApiAST,
  hookName: string,
  isInfiniteQuery: boolean,
  config: any,
): string {
  const infoParams = [
    ...config.params.filter((p: string) => !p.startsWith("options?:")),
    "extraQueryKey?: QueryKey",
  ].join(", ");

  const queryParamForPaging = isInfiniteQuery
    ? api.queryParamsTypeName
      ? getParamString("_param", true, api.queryParamsTypeName, undefined, true)
      : ""
    : "";

  return `
    ${hookName}.info = (${infoParams}) => {
      return {
        key: ${config.queryKey} as QueryKey,
        fun: (${queryParamForPaging}) => ${api.serviceName}(
          ${
            config.paramsStringOverride
              ? `${config.paramsStringOverride},
            `
              : ""
          }configOverride
        ),
      };
    };`;
}

/** Generate prefetch method for query hooks */
function generatePrefetchMethod(
  api: ApiAST,
  hookName: string,
  config: any,
): string {
  return `
    ${hookName}.prefetch = (
      client: QueryClient,
      ${config.params.join(", ")}
    ) => {
      const { extraQueryKey, ...queryOptions } = options || {};
      const { key, fun } = ${hookName}.info(${
        config.paramsString ? `${config.paramsString},` : ""
      }configOverride, extraQueryKey);

      return client.getQueryData(key)
        ? Promise.resolve()
        : client.prefetchQuery({
            queryKey: key,
            queryFn: () => fun(),
            ...queryOptions
          });
    };`;
}

/** Build final code with imports and exports */
function buildFinalCode(
  apisCode: string,
  types: TypeAST[],
  apis: ApiAST[],
  context: HookContext,
): string {
  let code = getHooksImports({
    hasInfinity: context.hasInfiniteQuery,
    hasSuspense: context.hasSuspenseQuery,
    hasSuspenseInfinity: context.hasSuspenseInfiniteQuery,
  });

  // Add type imports
  code += buildTypeImports(types, apisCode);

  // Add service imports
  code += buildServiceImports(apis);

  // Add helper functions
  code += getHooksFunctions({ hasInfinity: context.hasInfiniteQuery });

  // Add type definitions
  code += `
    export type SwaggerTypescriptMutationDefaultParams<TExtra> = {_extraVariables?: TExtra, configOverride?: AxiosRequestConfig}
    type SwaggerTypescriptExtraQueryKey = {
      /** Extra values appended to the end of the generated query key. */
      extraQueryKey?: QueryKey;
    };
    type SwaggerTypescriptUseQueryOptions<TData> = Omit<UseQueryOptions<SwaggerResponse<TData>, RequestError | Error>, "queryKey"> & SwaggerTypescriptExtraQueryKey;

    type SwaggerTypescriptUseMutationOptions<TData, TRequest, TExtra> = UseMutationOptions<
      SwaggerResponse<TData>,
      RequestError | Error,
      TRequest & SwaggerTypescriptMutationDefaultParams<TExtra>
    >;
  `;

  // Partial: the hook supplies queryKey, initialPageParam and getNextPageParam
  // itself, which react-query v5 otherwise makes mandatory on the options.
  if (context.hasInfiniteQuery) {
    code += `
    type SwaggerTypescriptUseInfiniteQueryOptions<TData> = Partial<
      UseInfiniteQueryOptions<SwaggerResponse<TData>, RequestError | Error>
    > & SwaggerTypescriptExtraQueryKey;
  `;
  }

  if (context.hasSuspenseQuery) {
    code += `
    type SwaggerTypescriptUseSuspenseQueryOptions<TData> = Omit<UseSuspenseQueryOptions<SwaggerResponse<TData>, RequestError | Error>, "queryKey"> & SwaggerTypescriptExtraQueryKey;
  `;
  }

  if (context.hasSuspenseInfiniteQuery) {
    code += `
    type SwaggerTypescriptUseSuspenseInfiniteQueryOptions<TData> = Partial<
      UseSuspenseInfiniteQueryOptions<SwaggerResponse<TData>, RequestError | Error>
    > & SwaggerTypescriptExtraQueryKey;
  `;
  }

  // Add SwaggerTypescriptUseMutationOptionsVoid only if needed
  if (context.hasMutationWithoutVariables) {
    code += `
    type SwaggerTypescriptUseMutationOptionsVoid<TData, TExtra> = UseMutationOptions<
      SwaggerResponse<TData>,
      RequestError | Error,
      SwaggerTypescriptMutationDefaultParams<TExtra> | void
    >;
  `;
  }

  // Add generated hooks
  code += apisCode;

  return code;
}

/** Build type imports from types used in APIs */
function buildTypeImports(types: TypeAST[], apisCode: string): string {
  const usedTypes = types
    .sort(({ name }, { name: other }) => isAscending(name, other))
    .filter(({ name }) => isMatchWholeWord(apisCode, getSchemaName(name)))
    .map(({ name }) => getSchemaName(name));

  if (usedTypes.length === 0) {
    return 'import type {} from "./types"\n';
  }

  return `import type { ${usedTypes.join(", ")} } from "./types"\n`;
}

/** Build service imports */
function buildServiceImports(apis: ApiAST[]): string {
  const services = apis.map(({ serviceName }) => serviceName);
  return `import { ${services.join(", ")} } from "./services"\n`;
}

export { generateHook };
