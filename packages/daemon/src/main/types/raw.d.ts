/** Ambient declaration for Vite `?raw` string imports (e.g. `.sql` migrations). */
declare module '*?raw' {
  const content: string;
  export default content;
}
