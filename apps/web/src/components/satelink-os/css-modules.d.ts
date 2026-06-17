// Ambient declaration so `import styles from './x.module.css'` is typed under
// strict TS (merges harmlessly with Next's built-in CSS-module support).
declare module '*.module.css' {
  const classes: { readonly [key: string]: string };
  export default classes;
}
