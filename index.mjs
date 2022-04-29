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
let id = 0;
while (queue.length) {
  const module = queue.shift();
  if (seen.has(module)) {
    continue;
  }
  seen.add(module);

  const dependencyMap = new Map(
    hasteFS
      .getDependencies(module)
      .map((dependencyName) => [
        dependencyName,
        resolver.resolveModule(module, dependencyName),
      ])
  );

  const code = fs.readFileSync(module, "utf8");
  const metadata = {
    // Assign a unique id to each module.
    id: id++,
    code,
    dependencyMap,
  };
  modules.set(module, metadata);
  queue.push(...dependencyMap.values());
}

console.log(chalk.bold(`❯ Found ${chalk.blue(seen.size)} files`));

console.log(chalk.bold(`❯ Serializing bundle`));
// Wrap modules with `define(<id>, function(module, exports, require) { <code> });`
const wrapModule = (id, code) =>
  `define(${id}, function(module, exports, require) {\n${code}});`;
// The code for each module gets added to this array.
const output = [];
for (const [module, metadata] of Array.from(modules).reverse()) {
  let { id, code } = metadata;
  for (const [dependencyName, dependencyPath] of metadata.dependencyMap) {
    const dependency = modules.get(dependencyPath);
    // Swap out the reference the required module with the generated
    // module it. We use regex for simplicity. A real bundler would likely
    // do an AST transform using Babel or similar.
    code = code.replace(
      new RegExp(
        `require\\(('|")${dependencyName.replace(/[\/.]/g, "\\$&")}\\1\\)`
      ),
      `require(${dependency.id})`
    );
  }
  // Wrap the code and add it to our output array.
  output.push(wrapModule(id, code));
}

// Add the `require`-runtime at the beginning of our bundle.
output.unshift(fs.readFileSync("./require.js", "utf8"));
// And require the entry point at the end of the bundle.
output.push(["requireModule(0);"]);
// Write it to stdout.
console.log(output.join("\n"));

if (options.output) {
  fs.writeFileSync(options.output, output.join("\n"), "utf8");
}
