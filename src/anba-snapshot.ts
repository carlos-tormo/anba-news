import type { GmRecord } from "./types.js";

const REQUEST_TIMEOUT_MS = 8_000;
const MAX_SUMMARY_CHARS = 2_500;

export interface TeamSnapshotContext {
  teamCode: string;
  teamName: string;
  sourceUrl: string;
  summaryText: string;
}

interface TeamListResponse {
  teams?: TeamListItem[];
}

interface TeamListItem {
  code?: string | null;
  name?: string | null;
  gm?: string | null;
  apron_hard_cap?: string | null;
}

interface TrackerResponse {
  tracker?: TrackerRow[];
}

interface TrackerRow {
  team_code?: string | null;
  team_name?: string | null;
  cap_total?: number | null;
  gasto_total?: number | null;
  espacio_cap?: number | null;
  espacio_luxury?: number | null;
  espacio_1er_apron?: number | null;
  espacio_2do_apron?: number | null;
  roster_standard_count?: number | null;
  roster_two_way_count?: number | null;
  draft_first_count?: number | null;
  draft_second_count?: number | null;
}

interface TeamDetailsResponse {
  team?: TeamDetails;
  players?: PlayerRecord[];
  assets?: AssetRecord[];
  dead_contracts?: DeadContractRecord[];
  summary?: TeamSummary;
  move_summary?: MoveSummary;
}

interface TeamDetails {
  code?: string | null;
  name?: string | null;
  gm?: string | null;
  apron_hard_cap?: string | null;
}

interface PlayerRecord {
  name?: string | null;
  position?: string | null;
  rating?: string | number | null;
  years_left?: number | null;
  salary_2025_num?: number | null;
  option_2026?: string | null;
  is_two_way?: number | boolean | null;
}

interface AssetRecord {
  asset_type?: string | null;
  year?: number | null;
  label?: string | null;
  detail?: string | null;
  draft_pick_type?: string | null;
  draft_round?: string | null;
  original_owner?: string | null;
  draft_pick_restricted?: number | boolean | null;
  draft_pick_protected?: number | boolean | null;
}

interface DeadContractRecord {
  label?: string | null;
  amount_num?: number | null;
  salary_2025_num?: number | null;
}

interface TeamSummary {
  cap_figure?: number | null;
  payroll?: number | null;
  room_to_cap?: number | null;
  room_to_luxury?: number | null;
  room_to_first_apron?: number | null;
  room_to_second_apron?: number | null;
  cash_limit_total?: number | null;
  roster_standard_count?: number | null;
  roster_two_way_count?: number | null;
  apron_hard_cap?: string | null;
  dead_cap?: number | null;
}

interface MoveSummary {
  phase?: string | null;
  remaining_pre30?: number | null;
  remaining_post30?: number | null;
  used_pre30?: number | null;
  used_post30?: number | null;
}

function normalizeBaseUrl(baseUrl: string | undefined): string | undefined {
  const trimmed = baseUrl?.trim().replace(/\/+$/, "");
  if (!trimmed) {
    return undefined;
  }

  try {
    return new URL(trimmed).toString().replace(/\/+$/, "");
  } catch {
    console.warn(`[snapshot] Invalid ANBA_EXCEL_BASE_URL: ${baseUrl}`);
    return undefined;
  }
}

function apiUrl(baseUrl: string, path: string): string {
  return `${baseUrl}${path}`;
}

async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }

    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeText(value: string | undefined | null): string {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function significantWords(value: string): string[] {
  return normalizeText(value)
    .split(" ")
    .filter((word) => word.length > 2 && !["los", "las", "the", "and"].includes(word));
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function asText(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function formatMoney(value: number | undefined): string {
  if (value === undefined) {
    return "n/d";
  }

  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) {
    return `${sign}$${(absolute / 1_000_000).toFixed(1)}M`;
  }

  return `${sign}$${Math.round(absolute).toLocaleString("en-US")}`;
}

function formatMargin(value: number | undefined): string {
  if (value === undefined) {
    return "n/d";
  }

  const direction = value >= 0 ? "por debajo" : "por encima";
  return `${formatMoney(Math.abs(value))} ${direction}`;
}

function isTwoWay(player: PlayerRecord): boolean {
  return player.is_two_way === true || player.is_two_way === 1;
}

function playerRating(player: PlayerRecord): number | undefined {
  return asNumber(player.rating);
}

function playerSalary(player: PlayerRecord): number | undefined {
  return asNumber(player.salary_2025_num);
}

function formatYearsLeft(value: number | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return `${value} ${value === 1 ? "año" : "años"}`;
}

function formatPlayer(player: PlayerRecord): string {
  const name = asText(player.name) ?? "Jugador sin nombre";
  const rating = playerRating(player);
  const salary = playerSalary(player);
  const yearsLeft = asNumber(player.years_left);
  const option2026 = asText(player.option_2026);
  const details = [
    asText(player.position),
    rating !== undefined ? `OVR ${rating}` : undefined,
    salary !== undefined ? formatMoney(salary) : undefined,
    formatYearsLeft(yearsLeft),
    option2026 ? `opción 2026 ${option2026}` : undefined
  ].filter(Boolean);

  return details.length > 0 ? `${name} (${details.join(", ")})` : name;
}

function boolLike(value: unknown): boolean {
  return value === true || value === 1;
}

function formatPick(asset: AssetRecord): string {
  const label = asText(asset.label) ?? [asset.year, asset.draft_round, asset.original_owner].filter(Boolean).join(" ");
  const flags = [
    asText(asset.draft_pick_type),
    boolLike(asset.draft_pick_restricted) ? "restringida" : undefined,
    boolLike(asset.draft_pick_protected) ? "protegida" : undefined
  ].filter(Boolean);

  return flags.length > 0 ? `${label} (${flags.join(", ")})` : label;
}

function sortBySalaryDesc(a: PlayerRecord, b: PlayerRecord): number {
  return (playerSalary(b) ?? 0) - (playerSalary(a) ?? 0);
}

function buildSummary(
  teamCode: string,
  details: TeamDetailsResponse,
  trackerRow: TrackerRow | undefined,
  sourceUrl: string
): TeamSnapshotContext {
  const team = details.team ?? {};
  const summary = details.summary ?? {};
  const moveSummary = details.move_summary ?? {};
  const teamName = asText(team.name) ?? asText(trackerRow?.team_name) ?? teamCode;
  const players = details.players ?? [];
  const standardPlayers = players.filter((player) => !isTwoWay(player));
  const twoWayPlayers = players.filter(isTwoWay);
  const picks = (details.assets ?? []).filter((asset) => asset.asset_type === "draft_pick");
  const usablePicks = picks.filter((pick) => pick.draft_pick_type !== "sold");
  const soldPicks = picks.filter((pick) => pick.draft_pick_type === "sold");
  const playerRights = (details.assets ?? []).filter((asset) => asset.asset_type === "player_right");
  const deadContracts = details.dead_contracts ?? [];
  const deadCap = asNumber(summary.dead_cap);
  const deadCapTotal =
    deadCap ??
    deadContracts.reduce((total, contract) => total + (asNumber(contract.salary_2025_num) ?? asNumber(contract.amount_num) ?? 0), 0);

  const topRatedPlayers = [...standardPlayers]
    .filter((player) => playerRating(player) !== undefined)
    .sort((a, b) => (playerRating(b) ?? 0) - (playerRating(a) ?? 0))
    .slice(0, 5)
    .map(formatPlayer);

  const topSalaryPlayers = [...standardPlayers].sort(sortBySalaryDesc).slice(0, 5).map(formatPlayer);
  const expiringPlayers = [...standardPlayers]
    .filter((player) => {
      const yearsLeft = asNumber(player.years_left);
      return yearsLeft !== undefined && yearsLeft <= 1;
    })
    .sort(sortBySalaryDesc)
    .slice(0, 5)
    .map(formatPlayer);

  const hardCap = asText(team.apron_hard_cap) ?? asText(summary.apron_hard_cap);
  const lines = [
    `Snapshot ANBA Excel: ${teamName} (${teamCode}).`,
    asText(team.gm) ? `GM en ANBA Excel: ${asText(team.gm)}.` : undefined,
    `Roster: ${asNumber(summary.roster_standard_count) ?? asNumber(trackerRow?.roster_standard_count) ?? standardPlayers.length} contratos estándar, ${asNumber(summary.roster_two_way_count) ?? asNumber(trackerRow?.roster_two_way_count) ?? twoWayPlayers.length} two-way.`,
    `Economía: payroll ${formatMoney(asNumber(summary.payroll) ?? asNumber(trackerRow?.gasto_total))}, cap figure ${formatMoney(asNumber(summary.cap_figure) ?? asNumber(trackerRow?.cap_total))}.`,
    `Márgenes: cap ${formatMargin(asNumber(summary.room_to_cap) ?? asNumber(trackerRow?.espacio_cap))}, luxury ${formatMargin(asNumber(summary.room_to_luxury) ?? asNumber(trackerRow?.espacio_luxury))}, primer apron ${formatMargin(asNumber(summary.room_to_first_apron) ?? asNumber(trackerRow?.espacio_1er_apron))}, segundo apron ${formatMargin(asNumber(summary.room_to_second_apron) ?? asNumber(trackerRow?.espacio_2do_apron))}.`,
    hardCap ? `Hard cap/apron marcado: ${hardCap}.` : undefined,
    `Movimientos: pre-30 usados ${asNumber(moveSummary.used_pre30) ?? "n/d"}, restantes ${asNumber(moveSummary.remaining_pre30) ?? "n/d"}; post-30 usados ${asNumber(moveSummary.used_post30) ?? "n/d"}, restantes ${asNumber(moveSummary.remaining_post30) ?? "n/d"}.`,
    `Cash disponible/límite: ${formatMoney(asNumber(summary.cash_limit_total))}.`,
    `Draft: ${asNumber(trackerRow?.draft_first_count) ?? "n/d"} primeras rondas y ${asNumber(trackerRow?.draft_second_count) ?? "n/d"} segundas rondas en tracker; ${usablePicks.length} picks propias/adquiridas y ${soldPicks.length} picks vendidas en detalle.`,
    usablePicks.length > 0 ? `Picks propias/adquiridas destacadas: ${usablePicks.slice(0, 6).map(formatPick).join("; ")}.` : undefined,
    soldPicks.length > 0 ? `Picks vendidas destacadas: ${soldPicks.slice(0, 5).map(formatPick).join("; ")}.` : undefined,
    topRatedPlayers.length > 0 ? `Núcleo por media: ${topRatedPlayers.join("; ")}.` : undefined,
    topSalaryPlayers.length > 0 ? `Contratos más altos 2025: ${topSalaryPlayers.join("; ")}.` : undefined,
    expiringPlayers.length > 0 ? `Contratos cortos/expirings: ${expiringPlayers.join("; ")}.` : undefined,
    deadContracts.length > 0 ? `Dead cap: ${deadContracts.length} contratos, total aproximado ${formatMoney(deadCapTotal)}.` : undefined,
    playerRights.length > 0 ? `Derechos de jugadores: ${playerRights.slice(0, 4).map((asset) => asText(asset.label)).filter(Boolean).join("; ")}.` : undefined
  ].filter(Boolean);

  return {
    teamCode,
    teamName,
    sourceUrl,
    summaryText: lines.join("\n").slice(0, MAX_SUMMARY_CHARS)
  };
}

export class AnbaSnapshotClient {
  private readonly baseUrl: string;
  private teamsPromise: Promise<TeamListItem[]> | undefined;
  private trackerPromise: Promise<TrackerRow[]> | undefined;
  private readonly teamDetailsPromises = new Map<string, Promise<TeamDetailsResponse>>();

  constructor(baseUrl: string) {
    const normalized = normalizeBaseUrl(baseUrl);
    if (!normalized) {
      throw new Error("ANBA_EXCEL_BASE_URL is not a valid URL.");
    }

    this.baseUrl = normalized;
  }

  async getTeamContext(gm: GmRecord): Promise<TeamSnapshotContext | null> {
    const teamCode = await this.resolveTeamCode(gm);
    if (!teamCode) {
      console.warn(`[snapshot] Could not resolve ANBA Excel team code for ${gm.team}.`);
      return null;
    }

    const [details, tracker] = await Promise.all([this.getTeamDetails(teamCode), this.getTracker()]);
    const trackerRow = tracker.find((row) => normalizeText(row.team_code) === normalizeText(teamCode));
    return buildSummary(teamCode, details, trackerRow, apiUrl(this.baseUrl, `/api/teams/${encodeURIComponent(teamCode)}`));
  }

  private async resolveTeamCode(gm: GmRecord): Promise<string | undefined> {
    const explicitCode = gm.teamCode?.trim().toUpperCase();
    if (explicitCode) {
      return explicitCode;
    }

    const teams = await this.getTeams();
    const normalizedTeam = normalizeText(gm.team);
    const normalizedDisplayName = normalizeText(gm.displayName);
    const gmWords = significantWords(gm.team);
    const nickname = gmWords.at(-1);

    const exactMatch = teams.find((team) => {
      return [team.code, team.name].some((value) => normalizeText(value) === normalizedTeam);
    });
    if (exactMatch?.code) {
      return exactMatch.code.toUpperCase();
    }

    const nameMatch = teams.find((team) => {
      const normalizedName = normalizeText(team.name);
      return (
        normalizedName.includes(normalizedTeam) ||
        normalizedTeam.includes(normalizedName) ||
        Boolean(nickname && normalizedName.split(" ").includes(nickname))
      );
    });
    if (nameMatch?.code) {
      return nameMatch.code.toUpperCase();
    }

    const gmMatch = teams.find((team) => normalizedDisplayName && normalizeText(team.gm) === normalizedDisplayName);
    return gmMatch?.code?.toUpperCase();
  }

  private async getTeams(): Promise<TeamListItem[]> {
    this.teamsPromise ??= fetchJson<TeamListResponse>(apiUrl(this.baseUrl, "/api/teams")).then(
      (response) => response.teams ?? []
    );
    return this.teamsPromise;
  }

  private async getTracker(): Promise<TrackerRow[]> {
    this.trackerPromise ??= fetchJson<TrackerResponse>(apiUrl(this.baseUrl, "/api/tracker")).then(
      (response) => response.tracker ?? []
    );
    return this.trackerPromise;
  }

  private async getTeamDetails(teamCode: string): Promise<TeamDetailsResponse> {
    const code = teamCode.toUpperCase();
    const existing = this.teamDetailsPromises.get(code);
    if (existing) {
      return existing;
    }

    const promise = fetchJson<TeamDetailsResponse>(apiUrl(this.baseUrl, `/api/teams/${encodeURIComponent(code)}`));
    this.teamDetailsPromises.set(code, promise);
    return promise;
  }
}

export function createAnbaSnapshotClient(baseUrl: string | undefined): AnbaSnapshotClient | null {
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized) {
    return null;
  }

  return new AnbaSnapshotClient(normalized);
}
