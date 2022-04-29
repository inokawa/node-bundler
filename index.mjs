import JestHasteMap from "jest-haste-map";
import { cpus } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "product");

const hasteMapOptions = {
  extensions: ["js"],
  maxWorkers: cpus().length,
  name: "jest-bundler",
  platforms: [],
  rootDir: root,
  roots: [root],
};

const hasteMap = new JestHasteMap.default(hasteMapOptions);
await hasteMap.setupCachePath(hasteMapOptions);
const { hasteFS, moduleMap } = await hasteMap.build();
console.log(hasteFS.getAllFiles());
