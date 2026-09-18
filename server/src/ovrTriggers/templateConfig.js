// Web BRD Section 18.2's "asset_management_templates.json" DOES exist in the repo, at
// references/0forimplementation/web/asset_management_templates.json - missed during the
// original kickoff research (which only searched the Desktop app codebase and the
// templates blob container, not this references/ subtree) and caught by the independent
// architect review, which found this module derived from BRD prose and the real JSON file
// disagreed on one filename (Main LED Home Look's image, see below). Reconciled to match
// that JSON file's actual content, not just the BRD's prose.
//
// Step 5: this module is now the SEED/DEFAULT data only, not the live source of truth at
// runtime. The real Edit/Save feature (Admin/Super Admin, per the user's explicit request)
// needs somewhere persistent to write changes to, and BRD Section 18 already requires this
// file to live in the Storage Account's templates container - so the live config now lives
// there (server/src/ovrTriggers/templatesStore.js), seeded from these exact constants the
// first time the server finds no blob there yet. Every runtime consumer (routes, RPI,
// asset-rules) reads via templatesStore.js, never this module directly - this module exists
// so the seed data lives in version control, not just in a mutable blob.
//
// destinations: which LED types this asset type applies to. "inner"/"outer" always travel
// together here (every OVR trigger except All Sponsor Logo and RPI also offers Main LED -
// Web BRD Section 16: "two files... one for Inner/Outer Surrounds, one for Main LED").
//
// filenameRule: "exact" (must equal requiredFilename, case-sensitive on the base name) or
// "contains" (must contain the given substring anywhere in the filename) - Web BRD Section
// 17: "the filename must match the predefined filename... If the filename does not match
// the required filename, the user must not be allowed to save the asset."
//
// storageFilename: the filename the file is saved/renamed to in blob storage. Usually the
// same as requiredFilename, except where Section 19/20 explicitly mandate a rename (e.g.
// Home Look's video is uploaded as any name but always saved as "Home Look.mp4").
//
// additionalCopy: an extra copy saved under a second filename in the same folder (Web BRD
// Section 19/20's "must also be copied and renamed as: default.png").
export const OVR_TRIGGER_TYPES = [
  {
    id: "home_look_surrounds",
    label: "Home Look",
    destinations: ["inner", "outer"],
    files: [
      {
        kind: "image",
        filenameRule: "exact",
        requiredFilename: "HOME_Look.png",
        storageFilename: "HOME_Look.png",
        additionalCopy: "default.png",
      },
      {
        kind: "video",
        filenameRule: "any", // Web BRD Section 19.1: "the video file must be renamed to: Home Look.mp4" - no predefined required upload filename, only a fixed storage rename.
        storageFilename: "Home Look.mp4",
      },
    ],
  },
  {
    id: "home_look_main",
    label: "Home Look (Main LED)",
    destinations: ["main"],
    files: [
      {
        kind: "image",
        filenameRule: "any",
        // Independent architect review: the actual asset_management_templates.json
        // (found at references/0forimplementation/web/ - it does exist, contrary to the
        // original kickoff research) specifies "HOME_Look" with no extension here,
        // distinct from RPI's "HOME_Look.png" below. Deliberate per the real config, not
        // a typo - corrected to match after the review found the live upload was
        // producing "HOME_Look.png" instead.
        storageFilename: "HOME_Look",
        additionalCopy: "default.png",
      },
      {
        kind: "video",
        filenameRule: "any",
        storageFilename: "Home Look.mp4",
      },
    ],
  },
  {
    id: "rpi_home_look",
    label: "RPI Home Look",
    destinations: ["rpi"],
    files: [
      {
        kind: "image",
        filenameRule: "contains",
        requiredFilename: "16x9_1080 STILL",
        storageFilename: "HOME_Look.png",
      },
    ],
  },
  {
    id: "time_out",
    label: "Time Out",
    destinations: ["inner", "outer", "main"],
    files: [{ kind: "video", filenameRule: "exact", requiredFilename: "TO.mp4", storageFilename: "TO.mp4" }],
  },
  {
    id: "water_break",
    label: "Water Break",
    destinations: ["inner", "outer", "main"],
    files: [
      { kind: "video", filenameRule: "exact", requiredFilename: "gamebreak.mp4", storageFilename: "gamebreak.mp4" },
    ],
  },
  {
    id: "game_point",
    label: "Game Point",
    destinations: ["inner", "outer", "main"],
    files: [
      { kind: "video", filenameRule: "exact", requiredFilename: "GM_POINT.mp4", storageFilename: "GM_POINT.mp4" },
    ],
  },
  {
    id: "match_point",
    label: "Match Point",
    destinations: ["inner", "outer", "main"],
    files: [
      {
        kind: "video",
        filenameRule: "exact",
        requiredFilename: "MATCH_POINT.mp4",
        storageFilename: "MATCH_POINT.mp4",
      },
    ],
  },
  {
    id: "championship_point",
    label: "Championship Point",
    destinations: ["inner", "outer", "main"],
    files: [
      {
        kind: "video",
        filenameRule: "exact",
        requiredFilename: "CHMP_POINT.mp4",
        storageFilename: "CHMP_POINT.mp4",
      },
    ],
  },
  {
    id: "winning_moment",
    label: "Winning Moment",
    destinations: ["inner", "outer", "main"],
    files: [
      {
        kind: "video",
        filenameRule: "exact",
        requiredFilename: "winner.mp4",
        storageFilename: "winner.mp4",
        // Web BRD Section 18.1: falls back to a copy of default.mp4 if winner.mp4 isn't
        // present. Per the user's explicit decision, default.mp4 is a real, per-table/
        // per-destination uploaded asset (Default Assets feature), not a static template.
        fallbackFrom: "default.mp4",
      },
    ],
  },
  {
    id: "champion_winning_moment",
    label: "Champion Winning Moment",
    destinations: ["inner", "outer", "main"],
    optional: true,
    files: [
      {
        kind: "video",
        filenameRule: "exact",
        requiredFilename: "champion_winner.mp4",
        storageFilename: "champion_winner.mp4",
        // Web BRD Section 26: explicitly no fallback relationship with winner.mp4/default.mp4.
      },
    ],
  },
];

// Web BRD Section 22: All Sponsor Logo is explicitly excluded from this generic template
// config ("governed by Sections 11 to 14 and Section 22 respectively") - it has its own
// one-off rule (exact filename, saved into both Inner and Outer, never Main LED) rather
// than fitting the destinations/files shape above. Kept as a separate, explicit constant
// so the distinction is visible in code, not just in a comment.
export const ALL_SPONSOR_LOGO = {
  id: "all_sponsor_logo",
  label: "All Sponsor Logo",
  destinations: ["inner", "outer"],
  filenameRule: "exact",
  requiredFilename: "GPMP.png", // User's explicit decision: exact match, not "contains".
  storageFilename: "all-adv.png",
};

export function findOvrTriggerType(id) {
  return OVR_TRIGGER_TYPES.find((t) => t.id === id) ?? null;
}
