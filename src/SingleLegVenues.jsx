// Single-leg lock card: where the hedge is resting / filled on each venue.
import { useEffect, useState } from "react";
import { venueRows } from "./singleLegView.js";

export function SingleLegVenues({ parlayId, supabase }) {
  const [orders, setOrders] = useState(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const { data, error } = await supabase
        .from("combo_single_orders")
        .select("venue,status,size,filled,open,price,updated_at")
        .eq("parlay_id", parlayId)
        .order("updated_at", { ascending: false });
      if (!alive) return;
      if (error) { setMissing(true); setOrders([]); return; }
      setOrders(data || []);
    };
    load();
    const t = setInterval(load, 10000);
    return () => { alive = false; clearInterval(t); };
  }, [parlayId, supabase]);
  if (orders == null) return <div className="muted">Loading…</div>;
  const rows = venueRows(orders);
  if (!rows.length) {
    return <div className="muted">{missing ? "Venue status unavailable." : "Waiting to rest on Kalshi and Polymarket. Once one side fills, the other shrinks to what's left."}</div>;
  }
  return (
    <ul className="single-leg-venues" style={{ margin: 0, paddingLeft: 18 }}>
      {rows.map((r) => <li key={r.venue}><b>{r.venue}:</b> {r.state}</li>)}
    </ul>
  );
}
