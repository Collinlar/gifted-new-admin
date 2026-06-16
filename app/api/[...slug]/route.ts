import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// ── Helpers ────────────────────────────────────────────────────────────────

function ok(data: unknown) {
  return NextResponse.json(data);
}

function err(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status });
}

// Convert snake_case Supabase rows to the camelCase shape pages expect,
// and remap `id` → `_id` so existing pages work without modification.
function cam(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === "id") {
      out["_id"] = v;
      out["id"] = v;
      continue;
    }
    const camel = k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    if (Array.isArray(v)) {
      out[camel] = v.map((item) =>
        item && typeof item === "object" ? cam(item as Record<string, unknown>) : item
      );
    } else if (v && typeof v === "object" && !(v instanceof Date)) {
      out[camel] = cam(v as Record<string, unknown>);
    } else {
      out[camel] = v;
    }
  }
  return out;
}

function rows(data: Record<string, unknown>[] | null) {
  return (data ?? []).map(cam);
}

// ── Router ─────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  const [p0, p1, p2] = slug;
  const url = req.nextUrl;

  // GET /dashboard-stats — counts + chart data without fetching all rows
  if (p0 === "dashboard-stats") {
    const now  = new Date();
    const year = now.getUTCFullYear();
    const currentMonth = now.getUTCMonth();
    // Use UTC month start to match UTC-based bucketing below
    const monthStart = new Date(Date.UTC(year, currentMonth, 1)).toISOString();

    // Build UTC month boundaries for the current year (12 months)
    const monthRanges = Array.from({ length: 12 }, (_, m) => ({
      start: new Date(Date.UTC(year, m, 1)).toISOString(),
      end:   new Date(Date.UTC(year, m + 1, 1)).toISOString(),
    }));

    const [
      { count: totalUsers },
      { count: newUsers },
      { count: totalCompetitions },
      { count: totalCourses },
      { count: totalExams },
      { count: contestExams },
      { data: recentRaw },
      { count: totalActiveUsers },
      ...monthlyResults
    ] = await Promise.all([
      supabase.from("users").select("*", { count: "exact", head: true }),
      supabase.from("users").select("*", { count: "exact", head: true }).gte("created_at", monthStart),
      supabase.from("competitions").select("*", { count: "exact", head: true }),
      supabase.from("courses").select("*", { count: "exact", head: true }),
      supabase.from("exams").select("*", { count: "exact", head: true }),
      supabase.from("exams").select("*", { count: "exact", head: true }).eq("contest", true),
      supabase.from("users").select("first_name,last_name,email,created_at").order("created_at", { ascending: false }).limit(6),
      supabase.from("quiz_reviews").select("*", { count: "exact", head: true }),
      // 12 registration counts + 12 quiz activity counts + 12 course activity counts = 36 parallel queries
      ...monthRanges.map(({ start, end }) =>
        supabase.from("users").select("*", { count: "exact", head: true }).gte("created_at", start).lt("created_at", end)
      ),
      ...monthRanges.map(({ start, end }) =>
        supabase.from("quiz_reviews").select("*", { count: "exact", head: true }).gte("created_at", start).lt("created_at", end)
      ),
      ...monthRanges.map(({ start, end }) =>
        supabase.from("course_progress").select("*", { count: "exact", head: true }).gte("created_at", start).lt("created_at", end)
      ),
    ]);

    // monthlyResults: [reg0..reg11, quiz0..quiz11, course0..course11]
    const monthBuckets = Array.from({ length: 12 }, (_, i) => ({
      month: i,
      count: (monthlyResults[i] as { count: number | null }).count ?? 0,
    }));
    const monthlyActive = Array.from({ length: 12 }, (_, i) => ({
      month: i,
      // quiz + course counts (not deduplicated across tables, but good enough for trend display)
      count: ((monthlyResults[12 + i] as { count: number | null }).count ?? 0) +
             ((monthlyResults[24 + i] as { count: number | null }).count ?? 0),
    }));

    return ok({
      totalUsers, newUsers, totalCompetitions, totalCourses, totalExams, contestExams,
      totalActiveUsers: totalActiveUsers ?? 0,
      recentUsers: (recentRaw ?? []).map((u) => ({
        firstName: u.first_name, lastName: u.last_name, email: u.email, createdAt: u.created_at,
      })),
      monthlyRegistrations: monthBuckets,
      monthlyActive,
    });
  }

  // GET /all-users  (supports ?page=0&limit=100&q=&category=&gender=&grade=&purpose=)
  if (p0 === "all-users") {
    const url = new URL(req.url);
    const page     = parseInt(url.searchParams.get("page")  || "0");
    const limit    = parseInt(url.searchParams.get("limit") || "100");
    const q        = url.searchParams.get("q")?.trim() || "";
    const category = url.searchParams.get("category") || "";
    const gender   = url.searchParams.get("gender")   || "";
    const grade    = url.searchParams.get("grade")    || "";
    const purpose  = url.searchParams.get("purpose")  || "";

    let query = supabase.from("users").select("*", { count: "exact" }).order("created_at", { ascending: false });

    if (q)        query = query.or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,email.ilike.%${q}%`);
    if (category) query = query.ilike("category", category);
    if (gender)   query = query.ilike("gender", gender);
    if (grade)    query = query.ilike("grade", `%${grade}%`);
    if (purpose)  query = query.contains("purpose_of_registration", [purpose]);

    const from = page * limit;
    const { data, count, error } = await query.range(from, from + limit - 1);
    if (error) return err(error.message);
    return ok({ users: rows(data), total: count ?? 0, page, limit });
  }

  // GET /all-exams-admin
  if (p0 === "all-exams-admin") {
    const { data } = await supabase.from("exams").select("*").order("created_at", { ascending: false }).range(0, 4999);
    return ok({ exams: rows(data), allExaminations: rows(data) });
  }

  // GET /all-exams/:id
  if (p0 === "all-exams" && p1) {
    const { data } = await supabase.from("exams").select("*").or(`id.eq.${p1},mongo_id.eq.${p1}`).single();
    return ok({ exam: data ? cam(data) : null });
  }

  // GET /all-courses-admin-info
  if (p0 === "all-courses-admin-info") {
    const { data } = await supabase.from("courses").select("*").order("created_at", { ascending: false });
    return ok({ courses: rows(data) });
  }

  // GET /all-tracks
  if (p0 === "all-tracks") {
    const { data } = await supabase.from("tracks").select("*").order("sort_order", { ascending: true });
    return ok({ tracks: rows(data) });
  }

  // GET /trackable-items — every competition/course/exam/camp with the track ids it's tagged into
  if (p0 === "trackable-items") {
    const [comps, courses, exams, camps, trackItems] = await Promise.all([
      supabase.from("competitions").select("id, name").order("name"),
      supabase.from("courses").select("id, title").order("title"),
      supabase.from("exams").select("id, title").order("title"),
      supabase.from("camps").select("id, name").order("name"),
      supabase.from("track_items").select("track_id, item_type, item_id"),
    ]);

    const ti = trackItems.data ?? [];
    const tagsFor = (type: string, id: string) =>
      ti.filter((t) => t.item_type === type && t.item_id === id).map((t) => t.track_id);

    const items = [
      ...(comps.data ?? []).map((c) => ({ id: c.id, type: "competition", label: c.name, trackIds: tagsFor("competition", c.id) })),
      ...(courses.data ?? []).map((c) => ({ id: c.id, type: "course", label: c.title, trackIds: tagsFor("course", c.id) })),
      ...(exams.data ?? []).map((e) => ({ id: e.id, type: "exam", label: e.title, trackIds: tagsFor("exam", e.id) })),
      ...(camps.data ?? []).map((c) => ({ id: c.id, type: "camp", label: c.name, trackIds: tagsFor("camp", c.id) })),
    ];

    return ok({ items });
  }

  // GET /track-analytics — how many users picked each track, how many registered per camp
  if (p0 === "track-analytics") {
    const [tracksRes, userTracksRes, campsRes, campRegsRes] = await Promise.all([
      supabase.from("tracks").select("id, name").order("sort_order", { ascending: true }),
      supabase.from("user_tracks").select("track_id"),
      supabase.from("camps").select("id, name"),
      supabase.from("camp_registrations").select("camp_id, status"),
    ]);

    const userTracks = userTracksRes.data ?? [];
    const trackCounts = (tracksRes.data ?? []).map((t) => ({
      id: t.id,
      name: t.name,
      userCount: userTracks.filter((ut) => ut.track_id === t.id).length,
    }));

    const campRegs = campRegsRes.data ?? [];
    const campCounts = (campsRes.data ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      registeredCount: campRegs.filter((r) => r.camp_id === c.id && r.status !== "cancelled").length,
    }));

    return ok({ trackCounts, campCounts });
  }

  // GET /all-camps — every camp, published or draft (admin needs to see both)
  if (p0 === "all-camps") {
    const { data } = await supabase.from("camps").select("*").order("start_date", { ascending: true });
    return ok({ camps: rows(data) });
  }

  // GET /all-competitions
  if (p0 === "all-competitions") {
    const { data } = await supabase.from("competitions").select("*").order("created_at", { ascending: false });
    const r = rows(data);
    return ok({ programs: r, AllCompetitions: r, allCompetitions: r, competitions: r });
  }

  // GET /all-announcements
  if (p0 === "all-announcements") {
    const { data } = await supabase.from("announcements").select("*").order("created_at", { ascending: false });
    return ok({ announcements: rows(data) });
  }

  // GET /all-badges
  if (p0 === "all-badges") {
    const { data } = await supabase.from("badges").select("*").order("created_at", { ascending: false });
    return ok({ badges: rows(data) });
  }

  // GET /all-groups
  if (p0 === "all-groups") {
    const { data } = await supabase.from("groups").select("*").order("created_at", { ascending: false });
    const r = rows(data);
    return ok({ groups: r, allGroups: r });
  }

  // GET /all-interest
  if (p0 === "all-interest") {
    const { data } = await supabase.from("interests").select("*").order("name");
    const r = rows(data);
    return ok({ interests: r, allInterest: r });
  }

  // GET /all-flashcards — enriched with course title
  if (p0 === "all-flashcards") {
    const { data } = await supabase.from("flashcards").select("*").order("created_at", { ascending: false });
    if (!data || data.length === 0) return ok({ flashcards: [], allFlashCards: [] });

    const courseIds = [...new Set(data.map((r: Record<string,unknown>) => r.course_id).filter(Boolean))] as string[];
    let cMap: Record<string, string> = {};
    if (courseIds.length > 0) {
      const { data: coursesData } = await supabase.from("courses").select("mongo_id,title").in("mongo_id", courseIds);
      for (const c of (coursesData || [])) cMap[c.mongo_id] = c.title;
    }

    const enriched = data.map((r: Record<string,unknown>) => ({
      ...(cam(r) as Record<string,unknown>),
      courseTitle: cMap[(r.course_id as string) || ""] || "",
    }));

    return ok({ flashcards: enriched, allFlashCards: enriched });
  }

  // GET /all-assessments  — paginated, enriched with student name
  if (p0 === "all-assessments") {
    const page = parseInt(url.searchParams.get("page") || "0");
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "100"), 200);
    const from = page * limit;
    const { data, count } = await supabase.from("assessments").select("*", { count: "exact" })
      .order("created_at", { ascending: false }).range(from, from + limit - 1);

    if (!data || data.length === 0) return ok({ assessments: [], total: count ?? 0, page, limit });

    // Join users by mongo_id
    const userIds = [...new Set(data.map((r: Record<string,unknown>) => r.user_id).filter(Boolean))] as string[];
    let uMap: Record<string, { name: string; school: string }> = {};
    if (userIds.length > 0) {
      const { data: usersData } = await supabase
        .from("users").select("mongo_id,first_name,last_name,school").in("mongo_id", userIds);
      for (const u of (usersData || [])) {
        uMap[u.mongo_id] = { name: `${u.first_name || ""} ${u.last_name || ""}`.trim(), school: u.school || "" };
      }
    }

    const enriched = data.map((r: Record<string,unknown>) => {
      const base = cam(r) as Record<string,unknown>;
      const u = uMap[(r.user_id as string) || ""] || { name: "", school: "" };
      return { ...base, studentName: u.name, studentSchool: u.school };
    });

    return ok({ assessments: enriched, total: count ?? 0, page, limit });
  }

  // GET /all-timed-challenges  — uses timed_challenge_sets (grouped) table
  if (p0 === "all-timed-challenges") {
    const { data } = await supabase.from("timed_challenge_sets").select("*").order("created_at", { ascending: false });
    if (data !== null) return ok({ timedChallenges: rows(data), allTimedChallenges: rows(data) });
    // fallback to legacy individual-question table
    const { data: legacy } = await supabase.from("timed_challenges").select("*").order("created_at", { ascending: false });
    return ok({ timedChallenges: rows(legacy), allTimedChallenges: rows(legacy) });
  }

  // GET /all-transactions
  if (p0 === "all-transactions") {
    const { data } = await supabase.from("transactions").select("*").order("created_at", { ascending: false });
    const r = rows(data);
    return ok({ transactions: r, allTransactions: r });
  }

  // GET /all-fedback  (note: typo preserved from original backend)
  if (p0 === "all-fedback") {
    const { data } = await supabase.from("feedbacks").select("*").order("created_at", { ascending: false }).range(0, 4999);
    const shaped = rows(data);
    return ok({ feedbacks: shaped, allFeedback: shaped });
  }

  // GET /all-pathways
  if (p0 === "all-pathways") {
    const { data } = await supabase.from("pathways").select("*").order("created_at", { ascending: false });
    const r = rows(data);
    return ok({ pathways: r, allPathways: r });
  }

  // GET /all-addons
  if (p0 === "all-addons") {
    const { data } = await supabase.from("addons").select("*").order("created_at", { ascending: false });
    const r = rows(data);
    return ok({ addons: r, allAddons: r });
  }

  // GET /all-enrollments — enriched with student name + course title
  if (p0 === "all-enrollments") {
    const page  = parseInt(url.searchParams.get("page")  || "0");
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "100"), 200);
    const from  = page * limit;
    const courseFilter = url.searchParams.get("course") || "";

    let q = supabase.from("enrollments").select("*", { count: "exact" }).order("created_at", { ascending: false });
    if (courseFilter) q = q.eq("course_id", courseFilter);
    const { data, count } = await q.range(from, from + limit - 1);

    if (!data || data.length === 0) return ok({ enrollments: [], total: 0, page, limit });

    const userIds   = [...new Set(data.map((r: Record<string,unknown>) => r.user_id).filter(Boolean))]   as string[];
    const courseIds = [...new Set(data.map((r: Record<string,unknown>) => r.course_id).filter(Boolean))] as string[];

    const [usersRes, coursesRes] = await Promise.all([
      userIds.length   ? supabase.from("users").select("mongo_id,first_name,last_name,email,school").in("mongo_id", userIds.slice(0,500))   : Promise.resolve({ data: [] }),
      courseIds.length ? supabase.from("courses").select("mongo_id,title").in("mongo_id", courseIds.slice(0,500))                           : Promise.resolve({ data: [] }),
    ]);

    const uMap: Record<string,{ name: string; email: string; school: string }> = {};
    for (const u of (usersRes.data || [])) uMap[u.mongo_id] = { name: `${u.first_name||""} ${u.last_name||""}`.trim(), email: u.email||"", school: u.school||"" };
    const cMap: Record<string,string> = {};
    for (const c of (coursesRes.data || [])) cMap[c.mongo_id] = c.title;

    const enriched = data.map((r: Record<string,unknown>) => {
      const base = cam(r) as Record<string,unknown>;
      const u = uMap[(r.user_id as string)||""] || { name: "", email: "", school: "" };
      return { ...base, studentName: u.name, studentEmail: u.email, studentSchool: u.school, courseTitle: cMap[(r.course_id as string)||""] || "" };
    });

    return ok({ enrollments: enriched, total: count ?? 0, page, limit });
  }

  // GET /all-admins
  if (p0 === "all-admins") {
    const { data } = await supabase.from("admins").select("id,email,created_at,updated_at,mongo_id").order("created_at", { ascending: true });
    return ok({ admins: rows(data) });
  }

  // GET /all-course-reviews — enriched with student name and course title
  if (p0 === "all-course-reviews") {
    const { data } = await supabase.from("course_reviews").select("*").order("created_at", { ascending: false });
    if (!data || data.length === 0) return ok({ reviews: [], courseReviews: [] });

    // Join users (mongo_id → user_id)
    const userIds = [...new Set(data.map((r: Record<string,unknown>) => r.user_id).filter(Boolean))] as string[];
    const courseIds = [...new Set(data.map((r: Record<string,unknown>) => r.course_id).filter(Boolean))] as string[];

    const [usersRes, coursesRes] = await Promise.all([
      userIds.length ? supabase.from("users").select("mongo_id,first_name,last_name,school").in("mongo_id", userIds.slice(0, 500)) : Promise.resolve({ data: [] }),
      courseIds.length ? supabase.from("courses").select("mongo_id,title").in("mongo_id", courseIds.slice(0, 500)) : Promise.resolve({ data: [] }),
    ]);

    const uMap: Record<string, { name: string; school: string }> = {};
    for (const u of (usersRes.data || [])) {
      uMap[u.mongo_id] = { name: `${u.first_name || ""} ${u.last_name || ""}`.trim(), school: u.school || "" };
    }
    const cMap: Record<string, string> = {};
    for (const c of (coursesRes.data || [])) cMap[c.mongo_id] = c.title;

    const enriched = data.map((r: Record<string,unknown>) => {
      const base = cam(r) as Record<string,unknown>;
      const u = uMap[(r.user_id as string) || ""] || { name: "", school: "" };
      return { ...base, studentName: u.name, studentSchool: u.school, courseTitle: cMap[(r.course_id as string) || ""] || "" };
    });

    return ok({ reviews: enriched, courseReviews: enriched });
  }

  // GET /all-exam-scores  — joins exam title via exams.mongo_id = exam_scores.quiz_id
  if (p0 === "all-exam-scores") {
    const { data: scores } = await supabase.from("exam_scores").select("*").order("created_at", { ascending: false });
    if (!scores || scores.length === 0) return ok({ examScores: [], scores: [] });

    // Build exam title map keyed by mongo_id
    const quizIds = [...new Set(scores.map((s: Record<string,unknown>) => s.quiz_id).filter(Boolean))] as string[];
    let examTitleMap: Record<string, string> = {};
    if (quizIds.length > 0) {
      const { data: examsData } = await supabase
        .from("exams")
        .select("mongo_id,title")
        .in("mongo_id", quizIds);
      if (examsData) {
        for (const e of examsData) examTitleMap[e.mongo_id] = e.title;
      }
    }

    const enriched = scores.map((s: Record<string,unknown>) => ({
      ...cam(s) as Record<string,unknown>,
      examTitle: examTitleMap[(s.quiz_id as string) || ""] || "Unknown exam",
    }));

    return ok({ examScores: enriched, scores: enriched });
  }

  // GET /all-registrations/:id  (id = competition id or program name)
  if (p0 === "all-registrations" && p1) {
    const { data } = await supabase
      .from("program_registrations")
      .select("*")
      .or(`program.eq.${p1},mongo_id.eq.${p1}`)
      .order("created_at", { ascending: false });
    return ok({ registrations: rows(data) });
  }

  // GET /fetch-registered-programs/:title/paid  OR  /pending
  if (p0 === "fetch-registered-programs" && p1 && p2) {
    const title = decodeURIComponent(p1);
    const isPaid = p2 === "paid";
    const q = supabase
      .from("program_registrations")
      .select("*")
      .ilike("program", `%${title}%`);
    if (p2 === "paid") q.eq("status", "paid");
    if (p2 === "pending") q.not("status", "eq", "paid");
    const { data } = await q.order("created_at", { ascending: false });
    return ok({ registrations: rows(data ?? []), isPaid });
  }

  // GET /fetch-registered-programs/:title  (no paid/pending suffix)
  if (p0 === "fetch-registered-programs" && p1 && !p2) {
    const title = decodeURIComponent(p1);
    const { data } = await supabase
      .from("program_registrations")
      .select("*")
      .ilike("program", `%${title}%`)
      .order("created_at", { ascending: false });
    return ok({ registrations: rows(data ?? []) });
  }

  // GET /all-course-progress/:id  OR  /course-progress-all/:id
  // course_progress.course_id stores MongoDB ObjectId — bridge via courses.mongo_id
  if ((p0 === "all-course-progress" || p0 === "course-progress-all") && p1) {
    // Resolve mongo_id for the course
    const { data: courseRow } = await supabase
      .from("courses")
      .select("id,mongo_id")
      .or(`id.eq.${p1},mongo_id.eq.${p1}`)
      .maybeSingle();
    const courseMongoId = courseRow?.mongo_id || p1;

    const { data } = await supabase
      .from("course_progress")
      .select("*")
      .eq("course_id", courseMongoId)
      .order("updated_at", { ascending: false });

    if (!data || data.length === 0) return ok({ progress: [] });

    // Join users manually (no FK constraints in this schema)
    const userIds = [...new Set(data.map((r: Record<string,unknown>) => r.user_id).filter(Boolean))] as string[];
    let uMap: Record<string, { firstName: string; lastName: string; email: string; school: string }> = {};
    if (userIds.length > 0) {
      const { data: usersData } = await supabase
        .from("users")
        .select("mongo_id,first_name,last_name,email,school")
        .in("mongo_id", userIds.slice(0, 500));
      if (usersData) {
        for (const u of usersData) {
          uMap[u.mongo_id] = { firstName: u.first_name || "", lastName: u.last_name || "", email: u.email || "", school: u.school || "" };
        }
      }
    }

    type UEntry = { firstName: string; lastName: string; email: string; school: string };
    const shaped = data.map((row: Record<string,unknown>) => {
      const r = cam(row) as Record<string,unknown>;
      const u: UEntry = uMap[(row.user_id as string) || ""] || { firstName: "", lastName: "", email: "", school: "" };
      r.firstName = u.firstName;
      r.lastName = u.lastName;
      r.email = u.email;
      r.school = u.school;
      return r;
    });
    return ok({ progress: shaped });
  }

  // GET /channel-feed/:channelId
  if (p0 === "channel-feed" && p1) {
    const { data } = await supabase
      .from("messages")
      .select("*, users(first_name, last_name)")
      .eq("channel_id", p1)
      .order("created_at", { ascending: true });
    const shaped = (data ?? []).map((msg) => {
      const m = cam(msg as Record<string, unknown>);
      const u = msg.users as Record<string, unknown> | null;
      if (u) m.senderName = `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim();
      return m;
    });
    return ok({ messages: shaped });
  }

  // GET /all-leaderboards — full leaderboards table enriched with user name and quiz title
  if (p0 === "all-leaderboards") {
    const { data } = await supabase
      .from("leaderboards")
      .select("*")
      .order("score", { ascending: false });
    if (!data || data.length === 0) return ok({ leaderboards: [] });

    const userIds  = [...new Set(data.map((r: Record<string,unknown>) => r.user_id).filter(Boolean))]  as string[];
    const courseIds = [...new Set(data.map((r: Record<string,unknown>) => r.course_id).filter(Boolean))] as string[];

    const [usersRes, examsRes] = await Promise.all([
      userIds.length  > 0 ? supabase.from("users").select("mongo_id,first_name,last_name,email,school").in("mongo_id", userIds.slice(0,500)) : Promise.resolve({ data: [] }),
      courseIds.length > 0 ? supabase.from("exams").select("mongo_id,title").in("mongo_id", courseIds.slice(0,500)) : Promise.resolve({ data: [] }),
    ]);

    const uMap: Record<string,{ name: string; email: string; school: string }> = {};
    for (const u of (usersRes.data || [])) {
      uMap[u.mongo_id] = { name: `${u.first_name || ""} ${u.last_name || ""}`.trim(), email: u.email || "", school: u.school || "" };
    }
    const eMap: Record<string,string> = {};
    for (const e of (examsRes.data || [])) eMap[e.mongo_id] = e.title;

    const enriched = data.map((r: Record<string,unknown>) => {
      const base = cam(r) as Record<string,unknown>;
      const u = uMap[(r.user_id as string) || ""] || { name: "", email: "", school: "" };
      return { ...base, studentName: u.name || (r.username as string) || "", email: u.email, school: u.school, quizTitle: eMap[(r.course_id as string) || ""] || "" };
    });
    return ok({ leaderboards: enriched });
  }

  // GET /fetch-contest-leaderboard/:id
  // leaderboards.course_id stores MongoDB ObjectId — bridge via exams.mongo_id
  if (p0 === "fetch-contest-leaderboard" && p1) {
    const { data: examRow } = await supabase
      .from("exams")
      .select("id,mongo_id")
      .or(`id.eq.${p1},mongo_id.eq.${p1}`)
      .maybeSingle();
    const mongoId = examRow?.mongo_id || p1;

    const { data } = await supabase
      .from("leaderboards")
      .select("*")
      .eq("course_id", mongoId)
      .order("score", { ascending: false });

    if (!data || data.length === 0) return ok({ leaderboard: [] });

    // Join users for name/email
    const userIds = [...new Set(data.map((r: Record<string,unknown>) => r.user_id).filter(Boolean))] as string[];
    let uMap: Record<string, { firstName: string; lastName: string; email: string }> = {};
    if (userIds.length > 0) {
      const { data: usersData } = await supabase
        .from("users")
        .select("mongo_id,first_name,last_name,email")
        .in("mongo_id", userIds.slice(0, 500));
      if (usersData) {
        for (const u of usersData) {
          uMap[u.mongo_id] = { firstName: u.first_name || "", lastName: u.last_name || "", email: u.email || "" };
        }
      }
    }

    type LBEntry = { firstName: string; lastName: string; email: string };
    const enriched = data.map((r: Record<string,unknown>) => {
      const base = cam(r) as Record<string,unknown>;
      const u: LBEntry = uMap[(r.user_id as string) || ""] || { firstName: "", lastName: "", email: "" };
      const name = (r.username as string) || (u.firstName ? `${u.firstName} ${u.lastName}`.trim() : "");
      return { ...base, name, email: u.email, correctAnswers: r.score, totalQuestions: null };
    });

    return ok({ leaderboard: enriched, results: enriched });
  }

  // GET /fetch-results/:id/:year
  // p1 = exam UUID, p2 = year (optional)
  // quiz_reviews.quiz_id stores the original MongoDB ObjectId, so we must bridge via exams.mongo_id
  if (p0 === "fetch-results" && p1) {
    // Step 1: resolve the exam's mongo_id so we can match quiz_reviews.quiz_id
    const { data: examRow } = await supabase
      .from("exams")
      .select("id,mongo_id")
      .or(`id.eq.${p1},mongo_id.eq.${p1}`)
      .maybeSingle();

    const mongoId = examRow?.mongo_id || p1; // fallback to p1 in case it's already a mongo id

    // Step 2: fetch quiz_reviews where quiz_id = mongoId (the MongoDB ObjectId)
    let qrQuery = supabase
      .from("quiz_reviews")
      .select("*")
      .eq("quiz_id", mongoId)
      .order("correct_answers", { ascending: false });

    if (p2) qrQuery = qrQuery.eq("year", p2);

    let { data: qrData } = await qrQuery;

    // If year filter returned nothing, fetch all for this quiz
    if (p2 && (!qrData || qrData.length === 0)) {
      const { data: all } = await supabase
        .from("quiz_reviews")
        .select("*")
        .eq("quiz_id", mongoId)
        .order("correct_answers", { ascending: false });
      qrData = all;
    }

    if (!qrData || qrData.length === 0) return ok({ results: [] });

    // Step 3: enrich with user data (school, email) by joining users.mongo_id = quiz_reviews.user_id
    const userMongoIds = [...new Set(qrData.map((r: Record<string,unknown>) => r.user_id).filter(Boolean))] as string[];
    let userMap: Record<string, { firstName: string; lastName: string; email: string; school: string }> = {};

    if (userMongoIds.length > 0) {
      const { data: usersData } = await supabase
        .from("users")
        .select("mongo_id,first_name,last_name,email,school")
        .in("mongo_id", userMongoIds.slice(0, 500)); // cap for safety
      if (usersData) {
        for (const u of usersData) {
          userMap[u.mongo_id] = {
            firstName: u.first_name || "",
            lastName: u.last_name || "",
            email: u.email || "",
            school: u.school || "",
          };
        }
      }
    }

    // Step 4: merge and return
    // Priority: quiz_reviews own fields (school, email) > users table join
    type QREntry = { firstName: string; lastName: string; email: string; school: string };
    const enriched = qrData.map((r: Record<string,unknown>) => {
      const u: QREntry = userMap[(r.user_id as string) || ""] || { firstName: "", lastName: "", email: "", school: "" };
      const base = cam(r) as Record<string,unknown>;
      const fullName = (r.full_name as string) || (u.firstName ? `${u.firstName} ${u.lastName}`.trim() : "");
      // school and email: prefer value stored directly on quiz_review (from MongoDB), fall back to users join
      const school = (r.school as string) || u.school || "";
      const email  = (r.email  as string) || u.email  || "";
      return {
        ...base,
        name: fullName,
        email,
        school,
        grade: r.grade || "",
        correctAnswers: r.correct_answers ?? 0,
        totalQuestions: r.number_of_questions ?? 0,
      };
    });

    return ok({ results: enriched });
  }

  return err("Not found", 404);
}

// ── POST ───────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  const [p0] = slug;
  const body = await req.json().catch(() => ({}));

  // POST /admin-login
  if (p0 === "admin-login") {
    const { email, password } = body;
    if (!email || !password) return err("Email and password required");

    const { data: admin } = await supabase
      .from("admins")
      .select("*")
      .eq("email", email)
      .single();

    if (!admin) return ok({ success: false, message: "No admin account found for that email." });

    // Passwords in admins table may be plain text (from MongoDB) or bcrypt hash
    let match = false;
    if (admin.password) {
      if (admin.password.startsWith("$2")) {
        const bcrypt = await import("bcryptjs");
        match = await bcrypt.compare(password, admin.password);
      } else {
        match = admin.password === password;
      }
    }

    if (!match) return ok({ success: false, message: "Incorrect password." });

    // Return a simple token — AuthGuard only checks if truthy
    const token = Buffer.from(`${email}:${Date.now()}`).toString("base64");
    return ok({ success: true, token, admin: cam(admin) });
  }

  // POST /add-admin
  if (p0 === "add-admin") {
    const { email, password } = body;
    if (!email || !password) return err("Email and password required");
    const bcrypt = await import("bcryptjs");
    const hashed = await bcrypt.hash(password, 10);
    const { data, error } = await supabase.from("admins").insert({ email, password: hashed }).select().single();
    if (error) return err(error.message);
    return ok({ admin: cam(data) });
  }

  // POST /add-announcement
  if (p0 === "add-announcement") {
    const { data, error } = await supabase.from("announcements").insert({
      title: body.title,
      body: body.body,
      cta_label: body.ctaLabel,
      cta_link: body.ctaLink,
      target_audience: body.targetAudience || "All Users",
      publish_date: body.publishDate || null,
      is_published: body.isPublished || false,
    }).select().single();
    if (error) return err(error.message);
    return ok({ announcement: cam(data) });
  }

  // POST /add-badge
  if (p0 === "add-badge") {
    const { data, error } = await supabase.from("badges").insert({
      name: body.name,
      description: body.description,
      icon: body.icon,
      color: body.color,
      criteria: body.criteria,
      criteria_value: body.criteriaValue,
      type: body.type,
      is_active: body.isActive !== false,
    }).select().single();
    if (error) return err(error.message);
    return ok({ badge: cam(data) });
  }

  // POST /add-camp
  if (p0 === "add-camp") {
    const { data, error } = await supabase.from("camps").insert({
      name: body.name,
      description: body.description,
      start_date: body.startDate,
      end_date: body.endDate,
      location: body.location,
      is_virtual: body.isVirtual || false,
      cost: parseFloat(body.cost) || 0,
      capacity: body.capacity ? parseInt(body.capacity) : null,
      type: body.type || [],
      image: body.image,
      link: body.link,
      publish: body.publish || false,
    }).select().single();
    if (error) return err(error.message);
    return ok({ camp: cam(data) });
  }

  // POST /add-track
  if (p0 === "add-track") {
    const slug = body.slug || (body.name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const { data, error } = await supabase.from("tracks").insert({
      name: body.name,
      slug,
      description: body.description,
      icon: body.icon,
      color: body.color,
      sort_order: body.sortOrder ?? 0,
      is_active: body.isActive !== false,
    }).select().single();
    if (error) return err(error.message);
    return ok({ track: cam(data) });
  }

  // POST /add-competition
  if (p0 === "add-competition") {
    const { data, error } = await supabase.from("competitions").insert({
      name: body.name || body.title,
      description: body.description,
      start_date: body.startDate,
      end_date: body.endDate,
      year: body.year ? String(body.year) : null,
      material_cost: parseFloat(body.materialCost) || 0,
      assessment_cost: parseFloat(body.assessmentCost) || 0,
      link: body.link,
      customizable_button: body.customizableButton,
      type: body.type || [],
      sub_types: body.subTypes || [],
      assessments: body.assessments || [],
      courses: body.courses || [],
    }).select().single();
    if (error) return err(error.message);
    return ok({ program: cam(data) });
  }

  // POST /add-course
  if (p0 === "add-course") {
    const { data, error } = await supabase.from("courses").insert({
      title: body.title,
      description: body.description,
      grade: body.grade || [],
      category: body.category || [],
      thumbnail: body.thumbnail,
      program: body.program || [],
      duration: body.duration,
      publish: body.publish || false,
      cost: body.cost ? String(body.cost) : null,
      tags: body.tags || [],
      features: body.features || [],
      level: body.level,
      instructor: body.instructor,
      featured: body.featured || false,
    }).select().single();
    if (error) return err(error.message);
    return ok({ course: cam(data) });
  }

  // POST /add-exam
  if (p0 === "add-exam") {
    const { data, error } = await supabase.from("exams").insert({
      title: body.title,
      description: body.description,
      grade: body.grade || [],
      time: body.time || body.timeLimit || null,
      number_of_questions: body.numberOfQuestions || body.numQuestions || null,
      image: body.image,
      questions: body.questions || [],
      featured: body.featured || false,
      publish: body.publish || false,
      contest: body.contest || false,
      allow_quiz_review: body.allowQuizReview || false,
      display_scores: body.displayScores || false,
      show_feedback_form: body.showFeedbackForm || false,
      shuffle_questions: body.shuffleQuestions || false,
      attempts_allowed: body.attemptsAllowed || 1,
      level: body.level,
      difficulty: body.difficulty,
      instructor: body.instructor,
      program: body.program,
      tags: body.tags || [],
    }).select().single();
    if (error) return err(error.message);
    return ok({ exam: cam(data) });
  }

  // POST /add-flashcard
  if (p0 === "add-flashcard") {
    const { data, error } = await supabase.from("flashcards").insert({
      course_id: body.courseId,
      question: body.question,
      answer: body.answer,
      difficulty: body.difficulty,
    }).select().single();
    if (error) return err(error.message);
    return ok({ flashcard: cam(data) });
  }

  // POST /add-group
  if (p0 === "add-group") {
    const { data, error } = await supabase.from("groups").insert({
      name: body.name,
      description: body.description,
      image: body.image,
      category: body.category,
      is_open: body.isOpen !== false,
      featured: body.featured || false,
    }).select().single();
    if (error) return err(error.message);
    return ok({ group: cam(data) });
  }

  // POST /add-interest
  if (p0 === "add-interest") {
    const { data, error } = await supabase.from("interests").insert({
      name: body.name || body.interest,
    }).select().single();
    if (error) return err(error.message);
    return ok({ interest: cam(data) });
  }

  // POST /upload-file  — multipart, uploads to Supabase storage, returns public URL
  if (p0 === "upload-file") {
    try {
      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      if (!file) return err("No file provided");
      const ext = file.name.split(".").pop() || "bin";
      const path = `uploads/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const buffer = Buffer.from(await file.arrayBuffer());
      const { error: upErr } = await supabase.storage
        .from("gifted-files")
        .upload(path, buffer, { contentType: file.type, upsert: false });
      if (upErr) return err(upErr.message);
      const { data: urlData } = supabase.storage.from("gifted-files").getPublicUrl(path);
      return ok({ url: urlData.publicUrl, path });
    } catch (e) {
      return err(String(e));
    }
  }

  // POST /add-pathway
  if (p0 === "add-pathway") {
    const { data, error } = await supabase.from("pathways").insert({
      title:       body.title,
      description: body.description,
      thumbnail:   body.thumbnail,
      courses:     body.courses || [],
      grade:       body.grade   || [],
      category:    body.category || [],
      tags:        body.tags    || [],
      cost:        body.cost    || null,
      publish:     body.publish || false,
      featured:    body.featured || false,
    }).select().single();
    if (error) return err(error.message);
    return ok({ pathway: cam(data) });
  }

  // POST /add-addon
  if (p0 === "add-addon") {
    const { data, error } = await supabase.from("addons").insert({
      name:        body.name,
      description: body.description,
      cost:        body.cost || null,
      type:        body.type || null,
      image:       body.image || null,
      content:     body.content || null,
      is_active:   body.isActive !== false,
    }).select().single();
    if (error) return err(error.message);
    return ok({ addon: cam(data) });
  }

  // POST /add-enrollment
  if (p0 === "add-enrollment") {
    const { data, error } = await supabase.from("enrollments").insert({
      user_id:           body.userId,
      course_id:         body.courseId,
      payment_reference: body.paymentReference || null,
      amount:            body.amount ? parseFloat(String(body.amount)) : null,
      status:            body.status || "active",
      enrolled_at:       body.enrolledAt || new Date().toISOString(),
    }).select().single();
    if (error) return err(error.message);
    return ok({ enrollment: cam(data) });
  }

  // POST /add-timed-challenge  — inserts into timed_challenge_sets
  if (p0 === "add-timed-challenge") {
    const { data, error } = await supabase.from("timed_challenge_sets").insert({
      title: body.title,
      duration: body.duration || 30,
      questions: body.questions || [],
    }).select().single();
    if (error) return err(error.message);
    return ok({ challenge: cam(data) });
  }

  return err("Not found", 404);
}

// ── PUT ────────────────────────────────────────────────────────────────────

export async function PUT(req: NextRequest, { params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  const [p0, p1, p2] = slug;
  const body = await req.json().catch(() => ({}));

  // PUT /set-item-tracks/:itemType/:itemId — replace the full set of track tags for one item
  if (p0 === "set-item-tracks" && p1 && p2) {
    const itemType = p1;
    const itemId = p2;
    const trackIds: string[] = Array.isArray(body.trackIds) ? body.trackIds : [];

    const del = await supabase.from("track_items").delete().eq("item_type", itemType).eq("item_id", itemId);
    if (del.error) return err(del.error.message);

    if (trackIds.length) {
      const insertRows = trackIds.map((trackId) => ({ track_id: trackId, item_type: itemType, item_id: itemId }));
      const { error } = await supabase.from("track_items").insert(insertRows);
      if (error) return err(error.message);
    }

    return ok({ success: true });
  }

  // PUT /update-camp/:id
  if (p0 === "update-camp" && p1) {
    const patch: Record<string, unknown> = {};
    if (body.name        !== undefined) patch.name        = body.name;
    if (body.description !== undefined) patch.description = body.description;
    if (body.startDate   !== undefined) patch.start_date   = body.startDate;
    if (body.endDate     !== undefined) patch.end_date     = body.endDate;
    if (body.location    !== undefined) patch.location    = body.location;
    if (body.isVirtual   !== undefined) patch.is_virtual   = body.isVirtual;
    if (body.cost        !== undefined) patch.cost        = parseFloat(body.cost) || 0;
    if (body.capacity    !== undefined) patch.capacity    = body.capacity ? parseInt(body.capacity) : null;
    if (body.type        !== undefined) patch.type        = body.type;
    if (body.image       !== undefined) patch.image       = body.image;
    if (body.link        !== undefined) patch.link        = body.link;
    if (body.publish     !== undefined) patch.publish     = body.publish;
    patch.updated_at = new Date().toISOString();
    const { data, error } = await supabase.from("camps").update(patch).eq("id", p1).select().single();
    if (error) return err(error.message);
    return ok({ camp: cam(data) });
  }

  // PUT /update-track/:id
  if (p0 === "update-track" && p1) {
    const patch: Record<string, unknown> = {};
    if (body.name        !== undefined) patch.name        = body.name;
    if (body.slug        !== undefined) patch.slug        = body.slug;
    if (body.description !== undefined) patch.description = body.description;
    if (body.icon        !== undefined) patch.icon        = body.icon;
    if (body.color       !== undefined) patch.color       = body.color;
    if (body.sortOrder   !== undefined) patch.sort_order  = body.sortOrder;
    if (body.isActive    !== undefined) patch.is_active   = body.isActive;
    const { data, error } = await supabase.from("tracks").update(patch).eq("id", p1).select().single();
    if (error) return err(error.message);
    return ok({ track: cam(data) });
  }

  // PUT /update-announcement/:id
  if (p0 === "update-announcement" && p1) {
    const patch: Record<string, unknown> = {};
    if (body.title !== undefined) patch.title = body.title;
    if (body.body !== undefined) patch.body = body.body;
    if (body.ctaLabel !== undefined) patch.cta_label = body.ctaLabel;
    if (body.ctaLink !== undefined) patch.cta_link = body.ctaLink;
    if (body.targetAudience !== undefined) patch.target_audience = body.targetAudience;
    if (body.publishDate !== undefined) patch.publish_date = body.publishDate || null;
    if (body.isPublished !== undefined) patch.is_published = body.isPublished;
    patch.updated_at = new Date().toISOString();
    const { data, error } = await supabase.from("announcements").update(patch).or(`id.eq.${p1},mongo_id.eq.${p1}`).select().single();
    if (error) return err(error.message);
    return ok({ announcement: cam(data) });
  }

  // PUT /update-badge/:id
  if (p0 === "update-badge" && p1) {
    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.description !== undefined) patch.description = body.description;
    if (body.icon !== undefined) patch.icon = body.icon;
    if (body.color !== undefined) patch.color = body.color;
    if (body.criteria !== undefined) patch.criteria = body.criteria;
    if (body.criteriaValue !== undefined) patch.criteria_value = body.criteriaValue;
    if (body.type !== undefined) patch.type = body.type;
    if (body.isActive !== undefined) patch.is_active = body.isActive;
    patch.updated_at = new Date().toISOString();
    const { data, error } = await supabase.from("badges").update(patch).or(`id.eq.${p1},mongo_id.eq.${p1}`).select().single();
    if (error) return err(error.message);
    return ok({ badge: cam(data) });
  }

  // PUT /update-course/:id
  if (p0 === "update-course" && p1) {
    const patch: Record<string, unknown> = {};
    if (body.title       !== undefined) patch.title       = body.title;
    if (body.description !== undefined) patch.description = body.description;
    if (body.grade       !== undefined) patch.grade       = body.grade;
    if (body.category    !== undefined) patch.category    = body.category;
    if (body.thumbnail   !== undefined) patch.thumbnail   = body.thumbnail;
    if (body.program     !== undefined) patch.program     = body.program;
    if (body.duration    !== undefined) patch.duration    = body.duration;
    if (body.publish     !== undefined) patch.publish     = body.publish;
    if (body.cost        !== undefined) patch.cost        = body.cost ? String(body.cost) : null;
    if (body.tags        !== undefined) patch.tags        = body.tags;
    if (body.features    !== undefined) patch.features    = body.features;
    if (body.level       !== undefined) patch.level       = body.level;
    if (body.instructor  !== undefined) patch.instructor  = body.instructor;
    if (body.featured    !== undefined) patch.featured    = body.featured;
    patch.updated_at = new Date().toISOString();
    const { data, error } = await supabase.from("courses").update(patch).or(`id.eq.${p1},mongo_id.eq.${p1}`).select().single();
    if (error) return err(error.message);
    return ok({ course: cam(data) });
  }

  // PUT /update-competition/:id
  if (p0 === "update-competition" && p1) {
    const patch: Record<string, unknown> = {};
    if (body.name              !== undefined) patch.name               = body.name;
    if (body.description       !== undefined) patch.description        = body.description;
    if (body.startDate         !== undefined) patch.start_date         = body.startDate;
    if (body.endDate           !== undefined) patch.end_date           = body.endDate;
    if (body.year              !== undefined) patch.year               = String(body.year);
    if (body.materialCost      !== undefined) patch.material_cost      = parseFloat(body.materialCost) || 0;
    if (body.assessmentCost    !== undefined) patch.assessment_cost    = parseFloat(body.assessmentCost) || 0;
    if (body.link              !== undefined) patch.link               = body.link;
    if (body.customizableButton !== undefined) patch.customizable_button = body.customizableButton;
    if (body.type              !== undefined) patch.type               = body.type;
    if (body.subTypes          !== undefined) patch.sub_types          = body.subTypes;
    if (body.assessments       !== undefined) patch.assessments        = body.assessments;
    if (body.courses           !== undefined) patch.courses            = body.courses;
    patch.updated_at = new Date().toISOString();
    const { data, error } = await supabase.from("competitions").update(patch).or(`id.eq.${p1},mongo_id.eq.${p1}`).select().single();
    if (error) return err(error.message);
    return ok({ program: cam(data) });
  }

  // PUT /update-exam/:id
  if (p0 === "update-exam" && p1) {
    const patch: Record<string, unknown> = {};
    if (body.title !== undefined) patch.title = body.title;
    if (body.description !== undefined) patch.description = body.description;
    if (body.featured !== undefined) patch.featured = body.featured;
    if (body.published !== undefined) patch.publish = body.published;
    if (body.publish !== undefined) patch.publish = body.publish;
    if (body.contest !== undefined) patch.contest = body.contest;
    if (body.questions !== undefined) patch.questions = body.questions;
    if (body.level !== undefined) patch.level = body.level;
    if (body.difficulty !== undefined) patch.difficulty = body.difficulty;
    if (body.time !== undefined) patch.time = body.time;
    if (body.attemptsAllowed !== undefined) patch.attempts_allowed = body.attemptsAllowed;
    if (body.allowQuizReview !== undefined) patch.allow_quiz_review = body.allowQuizReview;
    if (body.displayScores !== undefined) patch.display_scores = body.displayScores;
    if (body.showFeedbackForm !== undefined) patch.show_feedback_form = body.showFeedbackForm;
    if (body.shuffleQuestions !== undefined) patch.shuffle_questions = body.shuffleQuestions;
    patch.updated_at = new Date().toISOString();
    const { data, error } = await supabase.from("exams").update(patch).or(`id.eq.${p1},mongo_id.eq.${p1}`).select().single();
    if (error) return err(error.message);
    return ok({ exam: cam(data) });
  }

  // PUT /update-user/:id
  if (p0 === "update-user" && p1) {
    const patch: Record<string, unknown> = {};
    if (body.role             !== undefined) patch.role              = body.role;
    if (body.isSuspended      !== undefined) patch.is_suspended      = body.isSuspended;
    if (body.password         !== undefined) patch.password          = body.password;
    if (body.firstName        !== undefined) patch.first_name        = body.firstName;
    if (body.lastName         !== undefined) patch.last_name         = body.lastName;
    if (body.email            !== undefined) patch.email             = body.email;
    if (body.mobileNumber     !== undefined) patch.mobile_number     = body.mobileNumber;
    if (body.dob              !== undefined) patch.dob               = body.dob;
    if (body.gender           !== undefined) patch.gender            = body.gender;
    if (body.country          !== undefined) patch.country           = body.country;
    if (body.school           !== undefined) patch.school            = body.school;
    if (body.grade            !== undefined) patch.grade             = body.grade;
    if (body.category         !== undefined) patch.category          = body.category;
    patch.updated_at = new Date().toISOString();
    const { data, error } = await supabase.from("users").update(patch).or(`id.eq.${p1},mongo_id.eq.${p1}`).select().single();
    if (error) return err(error.message);
    return ok({ user: cam(data) });
  }

  // PUT /update-flashcard/:id
  if (p0 === "update-flashcard" && p1) {
    const patch: Record<string, unknown> = {};
    if (body.question   !== undefined) patch.question   = body.question;
    if (body.answer     !== undefined) patch.answer     = body.answer;
    if (body.difficulty !== undefined) patch.difficulty = body.difficulty;
    if (body.courseId   !== undefined) patch.course_id  = body.courseId;
    if (body.publish    !== undefined) patch.publish    = body.publish;
    if (body.featured   !== undefined) patch.featured   = body.featured;
    patch.updated_at = new Date().toISOString();
    const { data, error } = await supabase.from("flashcards").update(patch).or(`id.eq.${p1},mongo_id.eq.${p1}`).select().single();
    if (error) return err(error.message);
    return ok({ flashcard: cam(data) });
  }

  // PUT /update-pathway/:id
  if (p0 === "update-pathway" && p1) {
    const patch: Record<string, unknown> = {};
    if (body.title       !== undefined) patch.title       = body.title;
    if (body.description !== undefined) patch.description = body.description;
    if (body.thumbnail   !== undefined) patch.thumbnail   = body.thumbnail;
    if (body.courses     !== undefined) patch.courses     = body.courses;
    if (body.grade       !== undefined) patch.grade       = body.grade;
    if (body.category    !== undefined) patch.category    = body.category;
    if (body.tags        !== undefined) patch.tags        = body.tags;
    if (body.cost        !== undefined) patch.cost        = body.cost || null;
    if (body.publish     !== undefined) patch.publish     = body.publish;
    if (body.featured    !== undefined) patch.featured    = body.featured;
    patch.updated_at = new Date().toISOString();
    const { data, error } = await supabase.from("pathways").update(patch).or(`id.eq.${p1},mongo_id.eq.${p1}`).select().single();
    if (error) return err(error.message);
    return ok({ pathway: cam(data) });
  }

  // PUT /update-addon/:id
  if (p0 === "update-addon" && p1) {
    const patch: Record<string, unknown> = {};
    if (body.name        !== undefined) patch.name        = body.name;
    if (body.description !== undefined) patch.description = body.description;
    if (body.cost        !== undefined) patch.cost        = body.cost || null;
    if (body.type        !== undefined) patch.type        = body.type;
    if (body.image       !== undefined) patch.image       = body.image;
    if (body.content     !== undefined) patch.content     = body.content;
    if (body.isActive    !== undefined) patch.is_active   = body.isActive;
    patch.updated_at = new Date().toISOString();
    const { data, error } = await supabase.from("addons").update(patch).or(`id.eq.${p1},mongo_id.eq.${p1}`).select().single();
    if (error) return err(error.message);
    return ok({ addon: cam(data) });
  }

  // PUT /update-enrollment/:id  (revoke / reinstate)
  if (p0 === "update-enrollment" && p1) {
    const patch: Record<string, unknown> = {};
    if (body.status    !== undefined) patch.status    = body.status;
    if (body.amount    !== undefined) patch.amount    = parseFloat(String(body.amount));
    if (body.courseId  !== undefined) patch.course_id = body.courseId;
    if (body.userId    !== undefined) patch.user_id   = body.userId;
    patch.updated_at = new Date().toISOString();
    const { data, error } = await supabase.from("enrollments").update(patch).eq("id", p1).select().single();
    if (error) return err(error.message);
    return ok({ enrollment: cam(data) });
  }

  // PUT /update-pay-after-invoice
  if (p0 === "update-pay-after-invoice") {
    const id = body.id || body._id;
    if (!id) return err("Registration id required");
    const { data, error } = await supabase
      .from("program_registrations")
      .update({ status: "paid", updated_at: new Date().toISOString() })
      .or(`id.eq.${id},mongo_id.eq.${id}`)
      .select()
      .single();
    if (error) return err(error.message);
    return ok({ registration: cam(data) });
  }

  return err("Not found", 404);
}

// ── DELETE ─────────────────────────────────────────────────────────────────

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  const [p0, p1] = slug;

  async function del(table: string) {
    const { error } = await supabase.from(table).delete().or(`id.eq.${p1},mongo_id.eq.${p1}`);
    if (error) return err(error.message);
    return ok({ success: true });
  }

  // camps/tracks are new tables with no mongo_id column — use eq("id") directly
  // instead of del()'s id-or-mongo_id lookup. track_items/camp_registrations
  // cascade-delete automatically via their FK ON DELETE CASCADE.
  if (p0 === "delete-camp") {
    const { error } = await supabase.from("camps").delete().eq("id", p1);
    if (error) return err(error.message);
    return ok({ success: true });
  }
  if (p0 === "delete-track") {
    const { error } = await supabase.from("tracks").delete().eq("id", p1);
    if (error) return err(error.message);
    return ok({ success: true });
  }

  if (p0 === "delete-admin") return del("admins");
  if (p0 === "delete-announcement") return del("announcements");
  if (p0 === "delete-badge") return del("badges");
  if (p0 === "delete-competition") return del("competitions");
  if (p0 === "delete-course") return del("courses");
  if (p0 === "delete-exam") return del("exams");
  if (p0 === "delete-flashcard") return del("flashcards");
  if (p0 === "delete-group") return del("groups");
  if (p0 === "delete-interest") return del("interests");
  if (p0 === "delete-timed-challenge") return del("timed_challenge_sets");
  if (p0 === "delete-pathway") return del("pathways");
  if (p0 === "delete-addon")   return del("addons");
  if (p0 === "delete-enrollment") {
    const { error } = await supabase.from("enrollments").delete().eq("id", p1);
    if (error) return err(error.message);
    return ok({ success: true });
  }

  // DELETE /delete-message/:msgId  — messages table uses uuid id, no mongo_id
  if (p0 === "delete-message" && p1) {
    const { error } = await supabase.from("messages").delete().eq("id", p1);
    if (error) return err(error.message);
    return ok({ success: true });
  }

  return err("Not found", 404);
}
