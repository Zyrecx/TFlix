import { babel } from '@rollup/plugin-babel';
import terser from '@rollup/plugin-terser';
import { string } from 'rollup-plugin-string';

export default [
  {
    input: 'userScript.js',
    output: {
      file: '../dist/userScript.js',
      format: 'iife'
    },
    plugins: [
      string({
        include: '**/*.css'
      }),
      babel({
        babelHelpers: 'bundled',
        presets: ['@babel/preset-env']
      }),
      terser()
    ]
  }
];
