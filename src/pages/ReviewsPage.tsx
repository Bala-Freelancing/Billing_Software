// Module 12: Google reviews. Until Google approves API access, this page gives
// the owner ready-made replies to copy into Google; once connected, the same
// templates will reply in the app. Free: templates, no AI.
import { useState } from "react";
import type { ShopSettings } from "../../shared/masters";
import { draftReply, variantCount, type ReplyLanguage } from "../../shared/reviews";
import { Alert, Button, Card, PageHeader, SelectField, TextField } from "../components/ui";
import { useFetch } from "../lib/useFetch";

const STEPS = [
  "The shop's Google Business Profile is verified and has been active for 60 days or more.",
  "The shop has a website listed on that profile (a free one-page site is fine).",
  "A Google Cloud project is created and Google has approved Business Profile API access (reviewed within 14 days).",
  "The owner signs in with Google here once, to let the app read reviews and post replies.",
];

export function ReviewsPage() {
  const shop = useFetch<ShopSettings>("/settings/shop");
  const [name, setName] = useState("");
  const [stars, setStars] = useState(5);
  const [lang, setLang] = useState<ReplyLanguage>("en");
  const [variant, setVariant] = useState(0);
  const [copied, setCopied] = useState(false);
  const reply = draftReply(stars, name, shop.data?.shopName ?? "our shop", lang, variant);

  async function copy() {
    if (!reply) return;
    await navigator.clipboard.writeText(reply);
    setCopied(true);
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Google reviews" subtitle="Thank customers for their reviews with ready replies — free, no AI." />

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-bold text-slate-900">Connection to Google</h2>
          <span className="rounded-full bg-amber-50 px-3 py-1 text-sm font-semibold text-amber-800 ring-1 ring-inset ring-amber-200">Not connected yet</span>
        </div>
        <p className="mt-2 text-sm text-slate-600">When connected, new reviews appear here and 4–5 star reviews get a ready reply to post with one click. Needed first:</p>
        <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-slate-800">
          {STEPS.map((s) => <li key={s}>{s}</li>)}
        </ol>
      </Card>

      <Card>
        <h2 className="text-base font-bold text-slate-900">Write a reply</h2>
        <p className="mt-1 text-sm text-slate-600">Until the connection is ready: pick the review's stars, copy the reply, and paste it in Google Maps.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <TextField label="Reviewer's name" value={name} onChange={(e) => { setName(e.target.value); setCopied(false); }} />
          <SelectField label="Stars" value={String(stars)} onChange={(e) => { setStars(Number(e.target.value)); setCopied(false); }}>
            {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{"★".repeat(n)} ({n})</option>)}
          </SelectField>
          <SelectField label="Language" value={lang} onChange={(e) => { setLang(e.target.value as ReplyLanguage); setVariant(0); setCopied(false); }}>
            <option value="en">English</option>
            <option value="ta">தமிழ் (Tamil)</option>
          </SelectField>
        </div>
        <div className="mt-4">
          {reply ? (
            <>
              <p className="rounded-lg bg-[var(--erp-row-alt)] p-4 text-sm leading-relaxed text-slate-900 ring-1 ring-inset ring-[var(--erp-panel-border)]">{reply}</p>
              <div className="mt-3 flex flex-wrap gap-3">
                <Button type="button" onClick={copy}>{copied ? "Copied" : "Copy reply"}</Button>
                <Button type="button" variant="secondary" onClick={() => { setVariant((v) => (v + 1) % variantCount(lang)); setCopied(false); }}>Another wording</Button>
              </div>
            </>
          ) : (
            <Alert tone="info">For 3 stars or fewer, please write a personal reply — an unhappy customer deserves the owner's own words. Thank them, apologise for the trouble, and invite them to call the shop.</Alert>
          )}
        </div>
      </Card>
    </div>
  );
}
