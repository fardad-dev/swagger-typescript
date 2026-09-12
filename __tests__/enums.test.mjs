import { cleanOutputDir, generator } from "./main/utils.mjs";
import baseSwaggerJson from "./swagger.json";

// Only types reachable from an endpoint are generated, so expose the standalone
// enum schemas through one endpoint to keep them covered here
const swaggerJson = {
  ...baseSwaggerJson,
  paths: {
    ...baseSwaggerJson.paths,
    "/enums": {
      get: {
        responses: {
          200: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    enumWithoutName: {
                      $ref: "#/components/schemas/EnumWithoutName",
                    },
                    notificationLevel: {
                      $ref: "#/components/schemas/NotificationLevel",
                    },
                    type: { $ref: "#/components/schemas/Type" },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

describe("enums", () => {
  beforeAll(async () => {
    await cleanOutputDir("./__tests__/outputs/enums");
  });

  afterEach(async () => {
    await cleanOutputDir("./__tests__/outputs/enums");
  });

  test("generate enum as type", async () => {
    const {
      "services.ts": code,
      "hooks.ts": hooks,
      "types.ts": type,
    } = await generator(
      {
        url: "./__tests__/outputs/enums/swagger.json",
        dir: "./__tests__/outputs/enums",
        generateEnumAsType: true,
      },
      swaggerJson,
    );

    expect(code).toMatchSnapshot("generate Code");
    expect(hooks).toMatchSnapshot("generate hooks");
    expect(type).toMatchSnapshot("generate type");
  });

  test("generate enum", async () => {
    const {
      "services.ts": code,
      "hooks.ts": hooks,
      "types.ts": type,
    } = await generator(
      {
        url: "./__tests__/outputs/enums/swagger.json",
        dir: "./__tests__/outputs/enums",
      },
      swaggerJson,
    );

    expect(code).toMatchSnapshot("generate Code");
    expect(hooks).toMatchSnapshot("generate hooks");
    expect(type).toMatchSnapshot("generate type");
  });
});
