import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { describeDb } from "../../src/services/facets/lots/lot-fixture.js";
import { lotHttpFixture } from "./base-api-lot-http-fixture.js";

describeDb("b5 composed lot transitions", () => {
  it("applies workspace selection then deselection", async () => {
    const f = await lotHttpFixture();
    const { target, displayed } = await f.resolve(0);
    const sub = f.fixture.contributor.sub;
    const selected = await f.command("workspace", {
      mode: "real", target, displayed_version: displayed,
      expected_head_id: null, mutation: { action: "select", basket_id: f.fixture.selectionBasket },
    }, sub);
    expect(selected.status).toBe(200);
    const head = (await selected.json() as { result: { heads: Array<{ id: string }> } })
      .result.heads[0]!.id;
    const deselected = await f.command("workspace", {
      mode: "real", target, displayed_version: displayed,
      expected_head_id: head, mutation: { action: "deselect", basket_id: f.fixture.selectionBasket },
    }, sub);
    expect(deselected.status).toBe(200);
    expect((await deselected.json() as { result: { events: Array<{ facet: string }> } })
      .result.events.map((event) => event.facet)).toContain("selection");
  });

  it("drives pipeline and market lifecycles with explicit values", async () => {
    const f = await lotHttpFixture();
    const { target, displayed } = await f.resolve(1);
    const sub = f.fixture.contributor.sub;
    const base = { mode: "real", target, displayed_version: displayed, expected_head_id: null };
    const pipeline = await f.command("workspace",
      { ...base, mutation: { action: "set_pipeline", status: "sollicite" } }, sub);
    expect(pipeline.status).toBe(200);
    const pipelineHead = (await pipeline.json()).result.heads[0].id as string;
    const marketed = await f.command("workspace", { ...base,
      mutation: { action: "set_market", status: "en_vente",
        asking_price: "250000.00", listing_url: "https://synthetic.invalid/annonce/5" } }, sub);
    expect(marketed.status).toBe(200);
    const market = await marketed.json() as { result: {
      events: Array<{ askingPrice: string }>; heads: Array<{ id: string }> } };
    expect(market.result.events[0]).toMatchObject({ askingPrice: "250000.00" });
    expect((await f.command("workspace",
      { ...base, expected_head_id: market.result.heads[0]!.id,
        mutation: { action: "clear_market" } }, sub)).status).toBe(200);
    expect((await f.command("workspace",
      { ...base, expected_head_id: pipelineHead, mutation: { action: "clear_pipeline" } }, sub)).status).toBe(200);
  });

  it("keeps personal archive separate from workspace selection", async () => {
    const f = await lotHttpFixture();
    const { target, displayed } = await f.resolve(0);
    const sub = f.fixture.contributor.sub;
    const selected = await f.command("workspace", {
      mode: "real", target, displayed_version: displayed,
      expected_head_id: null, mutation: { action: "select", basket_id: f.fixture.selectionBasket },
    }, sub);
    const head = (await selected.json() as { result: { heads: Array<{ id: string }> } })
      .result.heads[0]!.id;
    const archived = await f.command("personal", {
      mode: "real", target, displayed_version: displayed,
      expected_head_id: null, mutation: { action: "discard", reasonCode: "N-NON-RES" },
    }, sub);
    expect(archived.status).toBe(200);
    const archiveHead = (await archived.json()).result.heads[0].id as string;
    const restored = await f.command("personal", {
      mode: "real", target, displayed_version: displayed,
      expected_head_id: archiveHead, mutation: { action: "restore" },
    }, sub);
    expect(restored.status).toBe(200);
    const deselected = await f.command("workspace", {
      mode: "real", target, displayed_version: displayed,
      expected_head_id: head, mutation: { action: "deselect", basket_id: f.fixture.selectionBasket },
    }, sub);
    expect(deselected.status).toBe(200);
  });

  it("isolates real and simulation modes", async () => {
    const f = await lotHttpFixture();
    const { target, displayed } = await f.resolve(0);
    const sub = f.fixture.contributor.sub;
    const real = await f.command("workspace", {
      mode: "real", target, displayed_version: displayed,
      expected_head_id: null, mutation: { action: "set_pipeline", status: "sollicite" },
    }, sub);
    expect(real.status).toBe(200);
    const simulated = await f.command("workspace", {
      mode: "simulation", target, displayed_version: displayed,
      expected_head_id: null, mutation: { action: "set_pipeline", status: "lettre_envoyee" },
    }, sub);
    expect(simulated.status).toBe(200);
    const realHead = (await real.json() as { result: { heads: Array<{ id: string }> } })
      .result.heads[0]!.id;
    const simulatedHead = (await simulated.json() as { result: { heads: Array<{ id: string }> } })
      .result.heads[0]!.id;
    expect(simulatedHead).not.toBe(realHead);
  });

  it("rejects loose payloads, missing reasons and reserved codes", async () => {
    const f = await lotHttpFixture();
    const { target, displayed } = await f.resolve(0);
    const sub = f.fixture.contributor.sub;
    const key = () => randomUUID();
    const loose = await f.command("workspace", {
      mode: "real", target, displayed_version: displayed, expected_head_id: null,
      mutation: { action: "set_pipeline", status: "sollicite", actor: "someone" },
    }, sub, key());
    expect(loose.status).toBe(400);
    const lower = await f.command("workspace", {
      mode: "real", target, displayed_version: displayed, expected_head_id: null,
      mutation: { action: "discard", reasonCode: "n-non-res" },
    }, f.fixture.moderator.sub, key());
    expect(lower.status).toBe(400);
    const missing = await f.command("workspace", {
      mode: "real", target, displayed_version: displayed, expected_head_id: null,
      mutation: { action: "discard" },
    }, f.fixture.moderator.sub, key());
    expect(missing.status).toBe(422);
    const reserved = await f.command("workspace", {
      mode: "real", target, displayed_version: displayed, expected_head_id: null,
      mutation: { action: "discard", reasonCode: "legacy-unknown" },
    }, f.fixture.moderator.sub, key());
    expect(reserved.status).toBe(400);
    expect(await reserved.json()).toEqual({ error: "invalid_facet_command" });
    const basket = await f.command("workspace", {
      mode: "real", target, displayed_version: displayed, expected_head_id: null,
      mutation: { action: "select", basket_id: "wrong-basket" },
    }, sub, key());
    expect(basket.status).toBe(400);
  });
});
