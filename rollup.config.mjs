import babel from "@rollup/plugin-babel";
import commonjs from "@rollup/plugin-commonjs";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import terser from "@rollup/plugin-terser";
import { readFileSync } from "fs";
import postcss from "rollup-plugin-postcss";

const pkg = JSON.parse(readFileSync("./package.json", "utf-8"));

const extensions = [".js", ".jsx", ".ts", ".tsx"];

const external = [
  "react",
  "react-dom",
  /^react\//,
  /^react-dom\//,
];

const babelPlugin = babel({
  extensions,
  babelHelpers: "runtime",
  plugins: ["@babel/plugin-transform-runtime"],
  presets: [
    ["@babel/preset-react", { runtime: "automatic" }],
    ["@babel/preset-typescript", { allExtensions: true, isTSX: true }],
    ["@babel/preset-env", { targets: "> 0.5%, not dead" }],
  ],
  exclude: /node_modules\/(?!decimal\.js)/,
});

export default [
  // CJS
  {
    input: "src/index.ts",
    external,
    output: {
      file: pkg.main,
      format: "cjs",
      exports: "named",
      sourcemap: false,
    },
    plugins: [
      nodeResolve({ extensions }),
      commonjs(),
      postcss({ extract: false, inject: true }),
      babelPlugin,
      terser({ mangle: false }),
    ],
  },
  // ESM
  {
    input: "src/index.ts",
    external,
    output: {
      file: pkg.module,
      format: "esm",
      exports: "named",
      sourcemap: false,
    },
    plugins: [
      nodeResolve({ extensions }),
      commonjs(),
      postcss({ extract: false, inject: true }),
      babelPlugin,
      terser({ mangle: false }),
    ],
  },
];
