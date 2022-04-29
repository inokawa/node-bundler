import { cpus } from "os";
import { dirname, resolve, join } from "path";
import { fileURLToPath } from "url";
import chalk from "chalk";
import JestHasteMap from "jest-haste-map";
import Resolver from "jest-resolve";
import yargs from "yargs";
import fs from "fs";

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
// This line is only necessary in `jest-haste-map` version 28 or later.
await hasteMap.setupCachePath(hasteMapOptions);
const { hasteFS, moduleMap } = await hasteMap.build();

const options = yargs(process.argv).argv;
const entryPoint = resolve(process.cwd(), options.entryPoint);
if (!hasteFS.exists(entryPoint)) {
  throw new Error(
    "`--entry-point` does not exist. Please provide a path to a valid file."
  );
}

console.log(chalk.bold(`❯ Building ${chalk.blue(options.entryPoint)}`));

const resolver = new Resolver.default(moduleMap, {
  extensions: [".js"],
  hasCoreModules: false,
  rootDir: root,
});

const seen = new Set();
const modules = new Map();
const queue = [entryPoint];
while (queue.length) {
  const module = queue.shift();
  if (seen.has(module)) {
    continue;
  }
  seen.add(module);

  // Resolve each dependency and store it based on their "name",
  // that is the actual occurrence in code via `require('<name>');`.
  const dependencyMap = new Map(
    hasteFS
      .getDependencies(module)
      .map((dependencyName) => [
        dependencyName,
        resolver.resolveModule(module, dependencyName),
      ])
  );

  const code = fs.readFileSync(module, "utf8");
  // Extract the "module body", in our case everything after `module.exports =`;
  const moduleBody = code.match(/module\.exports\s+=\s+(.*?);/)?.[1] || "";

  const metadata = {
    code: moduleBody || code,
    dependencyMap,
  };
  modules.set(module, metadata);
  queue.push(...dependencyMap.values());
}

console.log(chalk.bold(`❯ Found ${chalk.blue(seen.size)} files`));

console.log(chalk.bold(`❯ Serializing bundle`));
// Go through each module (backwards, to process the entry-point last).
for (const [module, metadata] of Array.from(modules).reverse()) {
  let { code } = metadata;
  for (const [dependencyName, dependencyPath] of metadata.dependencyMap) {
    // Inline the module body of the dependency into the module that requires it.
    code = code.replace(
      new RegExp(
        // Escape `.` and `/`.
        `require\\(('|")${dependencyName.replace(/[\/.]/g, "\\$&")}\\1\\)`
      ),
      modules.get(dependencyPath).code
    );
  }
  metadata.code = code;
}

console.log(modules.get(entryPoint).code);
