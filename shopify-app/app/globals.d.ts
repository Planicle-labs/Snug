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
    "s-page": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    "s-section": React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement> & { heading?: string },
      HTMLElement
    >;
    "s-text-field": React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement> & {
        name?: string;
        label?: string;
        details?: string;
        value?: string;
        onChange?: (e: any) => void;
        autocomplete?: string;
        error?: string;
      },
      HTMLElement
    >;
    "s-button": React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement> & { type?: "submit" | "button" | "reset" },
      HTMLElement
    >;
  }
}

