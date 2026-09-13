/**
 * Owns: loading check-in activity (trend and busy hours) from the dataset JSON or a gym's database functions.
 * Not here: shaping those rows into the CheckinActivity view, which lives in lib/gymHealth.ts.
 */
import activityData from "@/data/checkin_activity.json";
import { activityFromRows, type CheckinActivity } from "@/lib/gymHealth";
import type { MemberSource } from "@/lib/memberSource";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Where the attendance trend and the busy-hours grid come from.
 *
 * The synthetic dataset's summary is built offline (`data/checkin_activity.json`,
 * from `scripts/build-checkin-activity.ts`). A gym's uploaded check-ins are
 * summarised by two database functions, one call each, so a render never pages
 * through every visit. Either way a problem comes back as a notice beside the
 * section, never as numbers from somewhere else.
 */

const MIGRATION = "supabase/migrations/20260915000000_gym_health.sql";
const TIMEOUT_MS = 5000;

export interface ActivityLoad {
  activity: CheckinActivity | null;
  notice: string | null;
}

function isoDate(asOf: Date): string {
  return asOf.toISOString().slice(0, 10);
}

export async function loadCheckinActivity(source: MemberSource, asOf: Date): Promise<ActivityLoad> {
  if (source.kind === "dataset") {
    const { as_of, ...activity } = activityData as CheckinActivity & { as_of: string };
    if (as_of !== isoDate(asOf)) {
      return {
        activity: null,
        notice: `The check-in summary was built for ${as_of}, not ${isoDate(asOf)}. Run npm run data:build.`,
      };
    }
    return { activity, notice: null };
  }

  try {
    const args = { p_gym_id: source.gymId, p_as_of: isoDate(asOf) };
    const [weekly, hourly] = await Promise.all([
      supabaseAdmin.rpc("checkin_weekly", args).abortSignal(AbortSignal.timeout(TIMEOUT_MS)),
      supabaseAdmin.rpc("checkin_hourly", args).abortSignal(AbortSignal.timeout(TIMEOUT_MS)),
    ]);
    const error = weekly.error ?? hourly.error;
    if (error) {
      const missing = error.code === "PGRST202" || /could not find the function/i.test(error.message);
      return {
        activity: null,
        notice: missing ? `Check-in activity can't be read until ${MIGRATION} is applied.` : `Check-in activity couldn't be read: ${error.message}`,
      };
    }
    return {
      activity: activityFromRows(asOf, (weekly.data ?? []) as never[], (hourly.data ?? []) as never[]),
      notice: null,
    };
  } catch (err) {
    return { activity: null, notice: `Check-in activity couldn't be read: ${err instanceof Error ? err.message : String(err)}` };
  }
}
