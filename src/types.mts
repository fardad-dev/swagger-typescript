type DataType =
  /** This includes dates and files */
  "string" | "number" | "integer" | "boolean" | "array" | "object";

export interface Schema {
  title?: string;
  nullable?: boolean;
  ["x-nullable"]?: boolean;
  maxLength?: number;
  max?: number;
  min?: number;
  pattern?: string;
  type?: DataType;
  /**
   * An array of arbitrary types can be defined as:
   *
   *     Type: array;
   *     items: {
   *     }
   */
  items?: Schema | {};

  /**
   * Files are defined as strings: "binary" | "byte"
   *
   *     - integer int32	signed 32 bits
   *     - integer int64	signed 64 bits (a.k.a long)
   *     - number float
   *     - number double
   *     - string
   *     - string byte	base64 encoded characters
   *     - string binary	any sequence of octets
   *     - boolean
   *     - string date	As defined by full-date - RFC3339
   *     - string date-time	As defined by date-time - RFC3339
   *     - string password	A hint to UIs to obscure input.
   */
  format?:
    | "int32"
    | "int64"
    | "float"
    | "double"
    | "byte"
    | "binary"
    | "date"
    | "date-time"
    | "date"
    | "password"
    // C#
    | "guid"
    // Java
    | "uuid";
  /**
   * A free-form object (arbitrary property/value pairs) is defined as:
   *
   *     Type: object
   *     additionalProperties: {}
   *     Or additionalProperties: true
   */
  additionalProperties?: Schema | true | {};
  properties?: { [name: string]: Schema };
  /**
   * By default, all object properties are optional. You can specify the
   * required properties in the required list:
   */
  required?: string[];
  description?: string;
  example?: string;
  deprecated?: boolean;
  "x-deprecatedMessage"?: string;
  "x-enumNames"?: string[];
  enum?: string[];
  $ref?: string;
  allOf?: Schema[];
  oneOf?: Schema[];
  /** Is something link oneOf */
  anyOf?: Schema[];
  /**
   * Use the minimum and maximum keywords to specify the range of possible
   * values:
   *
   *     Type: integer;
   *     minimum: 1;
   *     maximum: 20;
   *
   * By default, the minimum and maximum values are included in the range, that
   * is:
   *
   *     Minimum ≤ value ≤ maximum
   *
   * To exclude the boundary values, specify exclusiveMinimum: true and
   * exclusiveMaximum: true. For example, you can define a floating-point number
   * range as 0–50 and exclude the 0 value:
   */
  minimum?: number;
  exclusiveMinimum?: boolean;
  exclusiveMaximum?: boolean;
  maximum?: number;

  /**
   * A schema without a type matches any data type – numbers, strings, objects,
   * and so on. {} is shorthand syntax for an arbitrary-type schema:
   *
   * @example
   *   components: {
   *     schemas: {
   *       AnyValue: {
   *       }
   *     }
   *   }
   */
  AnyValue?: {
    nullable?: boolean;
    description?: string;
  };

  discriminator?: {
    propertyName: string;
    mapping?: {
      [key: string]: string;
    };
  };
  readOnly?: boolean;
  writeOnly?: boolean;
  xml?: {
    name?: string;
    namespace?: string;
    prefix?: string;
    attribute?: boolean;
    wrapped?: boolean;
  };
  externalDocs?: {
    description?: string;
    url: string;
  };
  examples?: { [x: string]: string };
  not?: Schema;
  default?: any;
  multipleOf?: number;
  minLength?: number;
  maxItems?: number;
  minItems?: number;
  uniqueItems?: boolean;
  maxProperties?: number;
  minProperties?: number;
}

export type Parameter = {
  /**
   * The name of the parameter. Parameter names are case sensitive. If in is
   * "path", the name field MUST correspond to a template expression occurring
   * within the path field in the Paths Object. See Path Templating for further
   * information. If in is "header" and the name field is "Accept",
   * "Content-Type" or "Authorization", the parameter definition SHALL be
   * ignored. For all other cases, the name corresponds to the parameter name
   * used by the in property.
   */
  name: string;
  /** The location of the parameter. */
  in: "query" | "header" | "cookie" | "path";
  /**
   * Determines whether this parameter is mandatory. If the parameter location
   * is "path", this property is REQUIRED and its value MUST be true. Otherwise,
   * the property MAY be included and its default value is false.
   */
  required?: boolean; // true;
  /** The schema defining the type used for the parameter. */
  schema?: Schema;
  $ref?: string;
  /**
   * A brief description of the parameter. This could contain examples of use.
   * CommonMark syntax MAY be used for rich text representation.
   */
  description?: string;
  /**
   * Specifies that a parameter is deprecated and SHOULD be transitioned out of
   * usage. Default value is false.
   */
  deprecated?: boolean;
};

export interface SwaggerResponse {
  $ref?: string;
  description?: string;
  content?: Partial<
    Record<
      ApiAST["contentType"],
      Pick<Schema, "example" | "examples"> & {
        schema?: Schema;
      }
    >
  >;
}

export interface SwaggerRequest {
  tags?: string[]; // ["Account"];
  summary?: string; // "Get user account balance";
  operationId?: string; // "Account_GetBalance";
  parameters?: Parameter[];
  requestBody?: SwaggerResponse;
  responses: { [x: string]: SwaggerResponse };
  deprecated?: boolean;
  security?: any[];
  description?: string;
  externalDocs?: any;
  callbacks?: any;
  servers?: any[];
}

export interface Components {
  schemas?: Record<string, Schema>;
  parameters?: Record<string, Parameter>;
  requestBodies?: Record<string, SwaggerResponse>;
}

export interface SwaggerJson {
  openapi?: string;
  swagger?: string;
  paths: {
    [url: string]: PathItem;
  };
  components?: Components;
  info: InfoObject;
  servers?: any[];
  security?: any[];
  tags?: any[];
  externalDocs?: any;
}

export interface PathItem {
  $ref?: string;
  summary?: string;
  description?: string;
  get?: SwaggerRequest;
  put?: SwaggerRequest;
  post?: SwaggerRequest;
  delete?: SwaggerRequest;
  options?: SwaggerRequest;
  head?: SwaggerRequest;
  patch?: SwaggerRequest;
  trace?: SwaggerRequest;
  servers?: any[];
  parameters?: any[];
}
export interface InfoObject {
  title: string;
  version: string;
  description?: string;
  termsOfService?: string;
  contact?: any;
  license?: any;
}

export interface FileConfig {
  url?: string | { branch: string; url: string }[];
  dir: string;
  /**
   * SignalR json url generated by https://github.com/majidbigdeli/SigSpec
   *
   * @todo Repo need help
   */
  hub?: string;
  /** Default is false */
  keepJson?: boolean;
  reactHooks?: boolean;
  includes?: string[];
  excludes?: string[];
  useQuery?: string[];
  useInfiniteQuery?: string[];
  /**
   * Hooks which should suspend (useSuspenseQuery / useSuspenseInfiniteQuery).
   * Needs @tanstack/react-query v5
   */
  useSuspenseQuery?: string[];
  mock?: string;
  prettierPath?: string;
  language?: "javascript" | "typescript" | "kotlin";
  methodName?: string;
  prefix?: string;
  ignore?: {
    headerParams?: string[];
  };
  generateEnumAsType?: boolean;

  //kotlin
  kotlinPackage?: string;

  // CLI
  tag?: string[];
  /** Generate with local swagger.json */
  local?: boolean;
  /** Generate specific branch swagger */
  branch?: string;
}

export interface CLIConfig {
  tag?: string[];
  /** Generate with local swagger.json */
  local?: boolean;
  /** Generate specific branch swagger */
  branch?: string;

  /** _ swagger.config.json file path */
  config?: string;
}

export interface Config extends FileConfig, CLIConfig {}

export type SwaggerConfig = FileConfig | FileConfig[];

export type Method =
  | "get"
  | "put"
  | "post"
  | "delete"
  | "options"
  | "head"
  | "patch"
  | "trace";

export type ApiAST = {
  contentType:
    | "*/*"
    | "text/json"
    | "application/json"
    | "application/octet-stream"
    | "application/json-patch+json"
    | "application/*+json"
    | "multipart/form-data"
    | "application/x-www-form-urlencoded";

  summary: string | undefined;
  deprecated: boolean | undefined;
  serviceName: string;
  pathParams: Parameter[];
  requestBody: Schema | undefined;
  queryParamsTypeName: string | false;
  headerParams: string | Parameter[];
  isQueryParamsNullable: boolean;
  isHeaderParamsNullable: boolean;
  responses: Schema | undefined;
  pathParamsRefString: string | undefined;
  endPoint: string;
  method: Method;
  security: string;
  additionalAxiosConfig: string;
  queryParameters: Parameter[];
};

export type TypeAST = {
  name: string;
  schema?: Schema;
  description?: string;
};

export type JsdocAST = Pick<
  Schema,
  | "min"
  | "max"
  | "title"
  | "description"
  | "format"
  | "minimum"
  | "maximum"
  | "pattern"
  | "maxLength"
  | "minLength"
  | "example"
> & {
  deprecated?: string;
};

export type ConstantsAST = { value: string; name: string };
