import { cleanOutputDir, generator } from "./utils.mjs";
import swaggerJson from "./swagger.json";

const dir = "./__tests__/main/outputs/suspense";

/** Source of one generated hook, up to the next exported hook */
const getHookCode = (hooks, hookName) => {
  const start = hooks.indexOf(`export const ${hookName} =`);
  const end = hooks.indexOf("export const use", start + 1);

  return hooks.slice(start, end === -1 ? undefined : end);
};

describe("useSuspenseQuery", () => {
  beforeAll(async () => {
    await cleanOutputDir(dir);
  });

  afterEach(async () => {
    await cleanOutputDir(dir);
  });

  test("generate suspense hooks for listed apis", async () => {
    const { "hooks.ts": hooks } = await generator(
      {
        url: `${dir}/swagger.json`,
        dir,
        reactHooks: true,
        includes: [
          "^getBank$",
          "^getUserMe$",
          "^postServiceVerifyApiKey$",
          "^getBusinessUserConnectionActive$",
        ],
        useInfiniteQuery: ["useGetBusinessUserConnectionActive"],
        useSuspenseQuery: [
          // by service name
          "getBank",
          // by hook name, and not a GET
          "usePostServiceVerifyApiKey",
          // also in useInfiniteQuery
          "useGetBusinessUserConnectionActive",
        ],
      },
      swaggerJson,
    );

    expect(getHookCode(hooks, "useGetBank")).toContain("useSuspenseQuery({");
    expect(getHookCode(hooks, "usePostServiceVerifyApiKey")).toContain(
      "useSuspenseQuery({",
    );
    expect(getHookCode(hooks, "useGetBusinessUserConnectionActive")).toContain(
      "useSuspenseInfiniteQuery({",
    );

    // Not listed, stays a regular query
    const unlisted = getHookCode(hooks, "useGetUserMe");
    expect(unlisted).toContain("useQuery({");
    expect(unlisted).not.toContain("Suspense");

    expect(hooks).toMatchSnapshot("generate hooks");
  });

  test("does not import suspense hooks which are not used", async () => {
    const { "hooks.ts": hooks } = await generator(
      {
        url: `${dir}/swagger.json`,
        dir,
        reactHooks: true,
        includes: ["^getBank$", "^getUserMe$"],
        useSuspenseQuery: ["getBank", "notAnApi"],
      },
      swaggerJson,
    );

    expect(hooks).toContain("useSuspenseQuery,");
    expect(hooks).not.toContain("useSuspenseInfiniteQuery");
    expect(hooks).not.toContain("useInfiniteQuery");
  });
});
