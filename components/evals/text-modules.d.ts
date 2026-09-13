/** A `.txt` imported with `{ turbopackModuleType: "raw" }` is its contents as a string. */
declare module "*.txt" {
  const text: string;
  export default text;
}
