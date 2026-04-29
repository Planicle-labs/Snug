declare module "*.css";

declare namespace JSX {
  interface IntrinsicElements {
    "s-app-nav": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    "s-link": React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement> & { href?: string },
      HTMLElement
    >;
  }
}
