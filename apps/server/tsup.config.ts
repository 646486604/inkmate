import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  clean: true,
  sourcemap: true,
  // tsup 默认会把 node: 前缀去掉（为了兼容旧 Node），但 node:sqlite 去掉后就不再是内置模块。
  removeNodeProtocol: false,
});
