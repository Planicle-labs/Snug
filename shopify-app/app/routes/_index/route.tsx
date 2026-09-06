import type { LoaderFunctionArgs } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";

import { login } from "../../shopify.server";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>Snug — AI Sizing &amp; Fit Engine</h1>
        <p className={styles.text}>
          Eliminate apparel sizing guesswork, reduce returns, and boost conversions with intelligent reference-based fit recommendations.
        </p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input className={styles.input} type="text" name="shop" placeholder="my-store.myshopify.com" />
              <span>e.g: my-shop-domain.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Log in with Shopify
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          <li>
            <strong>Reference Brand Calibration</strong>. Match shopper sizes against top apparel brands they already wear (Snitch, Bewakoof, Being Human, Nobero, The Bear House).
          </li>
          <li>
            <strong>Garment Ease Calculation</strong>. Smart ease subtraction and anthropometric anchor models provide millimeter-accurate size predictions.
          </li>
          <li>
            <strong>Edge-Speed Storefront Widget</strong>. Instant sub-50ms recommendation widget powered by Cloudflare Workers with zero impact on store performance.
          </li>
        </ul>
      </div>
    </div>
  );
}

