import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import * as prettier from "prettier";
import * as TT2Plugin from "./index";

const prettify = (
  code: string,
  options: Partial<TT2Plugin.PrettierPluginTT2ParserOptions>
) =>
  prettier.format(code, {
    parser: "tt2" as any,
    plugins: [TT2Plugin],
    ...options,
  });

const testFolder = join(__dirname, "tests");
const tests = readdirSync(testFolder);

tests.forEach((test) =>
  it(test, () => {
    const path = join(testFolder, test);
    const input = readFileSync(join(path, "input.html")).toString();
    const expected = readFileSync(join(path, "expected.html")).toString();

    const configPath = join(path, "config.json");
    const configString =
      existsSync(configPath) && readFileSync(configPath)?.toString();
    const configObject = Object.assign({
      filepath: test,
      printWidth: 8000,
      bracketSameLine: true,
    },configString ? JSON.parse(configString) : {});

    

    const format = () => prettify(input, configObject);

    const expectedError = expected.match(/Error\("(?<message>.*)"\)/)?.groups
      ?.message;

    if (expectedError) {
      jest.spyOn(console, "error").mockImplementation(() => {});
      expect(format).toThrow(expectedError);
    } else {
      const result = format();
      expect(result).toEqual(expected);
      // Check that a second prettifying is not changing the result again.
      expect(prettify(result, configObject)).toEqual(expected);
    }
  })
);
