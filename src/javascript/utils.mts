import { Schema, Parameter, Config } from "../types.mjs";
import { getJsdoc } from "../utilities/jsdoc.mjs";
import { isAscending } from "../utils.mjs";

function getPathParams(parameters?: Parameter[]): Parameter[] {
  return (
    parameters?.filter(({ in: location }) => {
      return location === "path";
    }) || []
  );
}

function getHeaderParams(parameters: Parameter[] | undefined, config: Config) {
  const headerParamsArray =
    parameters?.filter(({ in: location, name }) => {
      return (
        location === "header" && !config.ignore?.headerParams?.includes(name)
      );
    }) || [];

  const params = getObjectType(headerParamsArray, config, undefined);

  return {
    params,
    isNullable: headerParamsArray.every(({ schema = {} }) => !schema.required),
  };
}

/**
 * Converts a string to PascalCase (first letter uppercase)
 *
 * @param str - String to convert
 * @returns PascalCase version of the string
 */
function toPascalCase(str: string): string {
  return `${str.substring(0, 1).toUpperCase()}${str.substring(1)}`;
}

/**
 * Replaces delimiter characters with uppercase following characters
 *
 * @param str - String to process
 * @param delimiter - Delimiter character to split on
 * @returns Processed string with delimiters removed and following chars
 *   uppercased
 */
function replaceWithUpper(str: string, delimiter: string) {
  let parts = str.split(delimiter);
  parts = parts.map((part) => toPascalCase(part));

  return parts.join("");
}

/**
 * Generates a service method name based on endpoint, method, and configuration
 *
 * @param endPoint - API endpoint path
 * @param method - HTTP method (GET, POST, etc.)
 * @param operationId - Optional operation ID from OpenAPI spec
 * @param config - Configuration object containing naming rules
 * @returns Generated service method name
 */
function generateServiceName(
  endPoint: string,
  method: string,
  operationId: string | undefined,
  config: Config,
): string {
  const { methodName, prefix = "" } = config;

  const cleanedEndPoint = endPoint.replace(new RegExp(`^${prefix}`, "i"), "");
  const path = getSchemaName(cleanedEndPoint);

  const methodNameTemplate = getTemplate(methodName, operationId);

  const serviceName = template(methodNameTemplate, {
    path,
    method,
    ...(operationId ? { operationId } : {}),
  });
  return serviceName;
}

function getTemplate(methodName?: string, operationId?: string) {
  const defaultTemplate = "{method}{path}";
  if (!methodName) {
    return defaultTemplate;
  }

  const hasMethodNameOperationId = /(\{operationId\})/i.test(methodName);

  if (hasMethodNameOperationId) {
    return operationId ? methodName : defaultTemplate;
  }

  return methodName;
}

const TYPES = {
  integer: "number",
  number: "number",
  boolean: "boolean",
  object: "object",
  string: "string",
  array: "array",
};

function getDefineParam(
  name: string,
  required: boolean = false,
  schema: Schema | undefined,
  config: Config,
  description?: string,
): string {
  return getParamString(
    name,
    required,
    getTsType(schema, config, undefined),
    description,
  );
}

function getParamString(
  name: string,
  required: boolean = false,
  type: string,
  description?: string,
  isPartial?: boolean,
): string {
  return `${getJsdoc({
    description,
  })}${name}${required ? "" : "?"}: ${isPartial ? `Partial<${type}>` : type}`;
}
//x-nullable
function normalizeObjectPropertyNullable(
  propertyName: string,
  schema: Schema,
  required?: string[],
) {
  if (schema.nullable !== undefined) {
    return schema.nullable;
  }
  if (schema["x-nullable"] !== undefined) {
    return schema["x-nullable"];
  }
  if (required) {
    return !required.includes(propertyName);
  }
  return true;
}

/**
 * Returns the name of the generated type a $ref points to
 *
 * @param $ref - The reference string
 * @returns Name of the generated type
 */
function getTypeNameFromRef($ref: string): string {
  const refArray = $ref.split("/");
  if (refArray[refArray.length - 2] === "requestBodies") {
    return `RequestBody${getRefName($ref)}`;
  }
  return getRefName($ref);
}

/**
 * Handles enum types and returns a union type string
 *
 * @param enumValues - Array of enum values
 * @returns TypeScript union type string
 */
function handleEnumType(enumValues: string[]): string {
  return enumValues.map((e) => JSON.stringify(e)).join(" | ");
}

/**
 * Handles array types
 *
 * @param items - The items schema for the array
 * @param config - Configuration object
 * @param schemasMap - Optional map of all schemas for discriminator resolution
 * @returns TypeScript array type string
 */
function handleArrayType(
  items: Schema,
  config: Config,
  schemasMap?: Map<string, Schema>,
): string {
  return `(${getTsType(items, config, schemasMap)})[]`;
}

/**
 * Handles object types with properties
 *
 * @param properties - Object properties
 * @param required - Required property names
 * @param config - Configuration object
 * @param discriminator - Optional discriminator information
 * @param schemasMap - Optional map of all schemas for discriminator resolution
 * @returns TypeScript object type string
 */
function handleObjectProperties(
  properties: { [name: string]: Schema },
  required: string[] | undefined,
  config: Config,
  discriminator?: { propertyName: string; mapping?: { [key: string]: string } },
  schemasMap?: Map<string, Schema>,
): string {
  return getObjectType(
    Object.entries(properties).map(([pName, _schema]) => {
      let schema = {
        ..._schema,
        nullable: normalizeObjectPropertyNullable(pName, _schema, required),
      };

      // If this is a discriminator property, use the mapping keys as a union type
      // and make it required (not nullable)
      if (
        discriminator &&
        pName === discriminator.propertyName &&
        discriminator.mapping
      ) {
        const discriminatorValues = Object.keys(discriminator.mapping);
        schema = {
          ...schema,
          enum: discriminatorValues,
          nullable: false,
        };
      }

      return {
        schema,
        name: pName,
      };
    }),
    config,
    schemasMap,
  );
}

/**
 * Handles oneOf schema compositions
 *
 * @param oneOf - Array of schemas for oneOf
 * @param result - Existing result string
 * @param config - Configuration object
 * @param schemasMap - Optional map of all schemas for discriminator resolution
 * @returns Updated result string
 */
function handleOneOfType(
  oneOf: Schema[],
  result: string,
  config: Config,
  schemasMap?: Map<string, Schema>,
): string {
  const unionTypes = oneOf
    .map((t) => `(${getTsType(t, config, schemasMap)})`)
    .join(" | ");
  return `${result} & (${unionTypes})`;
}

/**
 * Handles allOf schema compositions
 *
 * @param allOf - Array of schemas for allOf
 * @param result - Existing result string
 * @param config - Configuration object
 * @param schemasMap - Optional map of all schemas for discriminator resolution
 * @param currentTypeName - Optional current type name for discriminator
 *   resolution
 * @returns Updated result string
 */
function handleAllOfType(
  allOf: Schema[],
  result: string,
  config: Config,
  schemasMap?: Map<string, Schema>,
  currentTypeName?: string,
): string {
  const intersectionTypes = allOf
    .map((_schema) => getTsType(_schema, config, schemasMap))
    .join(" & ");

  let allOfResult = `${result ? `${result} &` : ""}(${intersectionTypes})`;

  // Check if any of the allOf schemas has a discriminator
  // If so, and we have a currentTypeName, add the discriminator literal type
  if (schemasMap && currentTypeName) {
    for (const schema of allOf) {
      if (schema.$ref) {
        const refName = getRefName(schema.$ref);
        const refSchema = schemasMap.get(refName);

        if (refSchema?.discriminator?.mapping) {
          // Find which discriminator value maps to the current type
          const discriminatorEntry = Object.entries(
            refSchema.discriminator.mapping,
          ).find(([, refPath]) => getRefName(refPath) === currentTypeName);

          if (discriminatorEntry) {
            const [discriminatorValue] = discriminatorEntry;
            const discriminatorProp = refSchema.discriminator.propertyName;
            // Add the discriminator property with literal type
            allOfResult = `{${discriminatorProp}: '${discriminatorValue}'} & ${allOfResult}`;
          }
        }
      }
    }
  }

  return allOfResult;
}

/**
 * Handles anyOf schema compositions
 *
 * @param anyOf - Array of schemas for anyOf
 * @param result - Existing result string
 * @param config - Configuration object
 * @param schemasMap - Optional map of all schemas for discriminator resolution
 * @returns Updated result string
 */
function handleAnyOfType(
  anyOf: Schema[],
  result: string,
  config: Config,
  schemasMap?: Map<string, Schema>,
): string {
  const unionTypes = anyOf
    .map((_schema) => getTsType(_schema, config, schemasMap))
    .join(" | ");
  return `${result ? `${result} |` : ""}(${unionTypes})`;
}

/**
 * Handles basic object types without specific properties
 *
 * @param additionalProperties - Additional properties schema or boolean
 * @param config - Configuration object
 * @returns TypeScript object type string
 */
function handleBasicObjectType(
  additionalProperties: Schema | true | {} | undefined,
  config: Config,
): string {
  if (additionalProperties) {
    return `{[x: string]: ${getTsType(additionalProperties, config)}}`;
  }
  return "{[x in string | number ]: any}";
}

/**
 * Main function to convert a schema to TypeScript type
 *
 * @param schema - The schema to convert
 * @param config - Configuration object
 * @param schemasMap - Optional map of all schemas for discriminator resolution
 * @param currentTypeName - Optional current type name for discriminator
 *   resolution
 * @returns TypeScript type string
 */
function getTsType(
  schema: undefined | true | {} | Schema,
  config: Config,
  schemasMap?: Map<string, Schema>,
  currentTypeName?: string,
): string {
  if (isTypeAny(schema)) {
    return "any";
  }

  const {
    type,
    $ref,
    enum: Enum,
    items,
    properties,
    oneOf,
    additionalProperties,
    required,
    allOf,
    anyOf,
    nullable,
    discriminator,
  } = schema as Schema;

  // Handle reference types
  if ($ref) {
    return getTypeNameFromRef($ref);
  }

  // Handle enum types
  if (Enum) {
    return handleEnumType(Enum);
  }

  // Handle array types
  if (items) {
    return handleArrayType(items, config, schemasMap);
  }

  let result = "";

  // Handle object properties
  if (properties) {
    result += handleObjectProperties(
      properties,
      required,
      config,
      discriminator,
      schemasMap,
    );
  }

  // Handle schema compositions
  if (oneOf) {
    result = handleOneOfType(oneOf, result, config, schemasMap);
  }

  if (allOf) {
    result = handleAllOfType(
      allOf,
      result,
      config,
      schemasMap,
      currentTypeName,
    );
  }

  if (anyOf) {
    result = handleAnyOfType(anyOf, result, config, schemasMap);
  }

  // Handle basic object types
  if (type === "object" && !result) {
    return handleBasicObjectType(additionalProperties, config);
  }

  // Handle nullable types
  if (!result && !type && nullable) {
    return "null";
  }

  // Return result or fallback to basic type mapping
  return result || TYPES[type as keyof typeof TYPES];
}

function getObjectType(
  parameter: { schema?: Schema; name: string }[],
  config: Config,
  schemasMap?: Map<string, Schema>,
) {
  const object = parameter
    .sort(
      (
        { name, schema: { nullable } = {} },
        { name: _name, schema: { nullable: _nullable } = {} },
      ) => {
        if (!nullable && _nullable) {
          return -1;
        } else if (nullable && !_nullable) {
          return 1;
        }

        return isAscending(name, _name);
      },
    )
    .reduce(
      (
        prev,
        {
          schema: {
            deprecated,
            "x-deprecatedMessage": deprecatedMessage,
            example,
            nullable,
          } = {},
          schema,
          name,
        },
      ) => {
        return `${prev}${getJsdoc({
          ...schema,
          deprecated:
            deprecated || deprecatedMessage ? deprecatedMessage : undefined,
          example,
        })}"${name}"${nullable ? "?" : ""}: ${getTsType(
          schema,
          config,
          schemasMap,
        )};`;
      },
      "",
    );

  return object ? `{${object}}` : "";
}
function getSchemaName(name: string): string {
  ["/", ".", "`", "[", "]", "-", "*", "{", "}"].forEach((str) => {
    name = replaceWithUpper(name, str);
  });

  return name;
}

function getRefName($ref: string): string {
  const parts = $ref.split("/").pop();
  return getSchemaName(parts || "");
}

function getParametersInfo(
  parameters: Parameter[] | undefined,
  type: "query" | "header",
) {
  const params =
    parameters?.filter(({ in: location }) => {
      return location === type;
    }) || [];

  return {
    params,
    exist: params.length > 0,
    isNullable: !params.some(
      ({ schema, required }) =>
        //swagger 2
        required ||
        // openapi 3
        schema?.required,
    ),
  };
}

function isTypeAny(type: true | undefined | {} | Schema) {
  if (type === true) {
    return true;
  }

  if (typeof type === "object" && Object.keys(type).length <= 0) {
    return true;
  }

  if (!type || (type as Schema).AnyValue) {
    return true;
  }

  return false;
}

/** Used to replace {name} in string with obj.name */
function template(str: string, obj: { [x: string]: string } = {}) {
  Object.entries(obj).forEach(([key, value]) => {
    const re = new RegExp(`{${key}}`, "i");
    str = str.replace(re, value);
  });

  const re = new RegExp("{*}", "g");
  if (re.test(str)) {
    throw new Error(`methodName: Some A key is missed "${str}"`);
  }
  return str;
}
export {
  getPathParams,
  getHeaderParams,
  generateServiceName,
  getTsType,
  getRefName,
  getTypeNameFromRef,
  isAscending,
  getDefineParam,
  getParamString,
  getParametersInfo,
  isTypeAny,
  template,
  toPascalCase,
  getSchemaName,
};
