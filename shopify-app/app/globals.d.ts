declare module "*.css";
declare module "*.module.css" {
  const classes: Record<string, string>;
  export default classes;
}

declare namespace JSX {
  interface IntrinsicElements {
    "s-app-nav": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    "s-link": React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement> & { href?: string },
      HTMLElement
    >;
  }
}
