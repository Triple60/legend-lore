/**
 * Sample campaign for demo builds: a small slice of Barovia, enough to try
 * the map, search, filters, sessions, notes links and history.
 * `sampleData()` returns fresh copies, so each page load starts clean.
 */

export const DEMO_USER = { id: 'demo-user', name: 'Demo player', email: 'demo@example.invalid' };
const OTHER = { id: 'demo-ireena', name: 'Ireena' };
const CAMPAIGN = 'demo-barovia';
const T0 = '2026-10-01T19:00:00.000Z';

type Row = Record<string, unknown>;
export interface DemoTables {
	campaigns: Row[];
	campaign_members: Row[];
	campaign_invites: Row[];
	profiles: Row[];
	node_types: Row[];
	nodes: Row[];
	edges: Row[];
	revisions: Row[];
}

const TYPES = [
	['place', 'Place', '#4e79a7'],
	['person', 'Person', '#e15759'],
	['object', 'Object', '#f28e2b'],
	['lore', 'Lore', '#76b7b2'],
	['faction', 'Faction', '#b07aa1']
] as const;

// [id, type, name, aliases, tags, session, notes]
const NODES: [string, string, string, string[], string[], number | null, string][] = [
	['village', 'place', 'Village of Barovia', ['Barovia'], ['barovia', 'village'], 1,
		'A gloomy village at the foot of [[Castle Ravenloft]]. Most doors stay shut after dark.'],
	['castle', 'place', 'Castle Ravenloft', ['Ravenloft'], ['barovia', 'castle'], 1,
		"[[Strahd von Zarovich|Strahd]]'s seat, high on a spire of rock above [[Village of Barovia|the village]]."],
	['vallaki', 'place', 'Vallaki', [], ['barovia', 'town'], 3,
		'A walled town where the Baron insists that *all will be well*.'],
	['krezk', 'place', 'Krezk', [], ['barovia', 'village'], 6, 'A small walled village around an abbey.'],
	['tser-pool', 'place', 'Tser Pool', [], ['barovia', 'vistani'], 2, 'A Vistani camp by the river.'],
	['blue-water', 'place', 'Blue Water Inn', [], ['vallaki', 'inn'], 3, 'Run by the Martikov family. Excellent wine, when there is any.'],
	['strahd', 'person', 'Strahd von Zarovich', ['Strahd', 'The Devil'], ['vampire', 'villain'], 1,
		'Lord of Barovia. Seen at a distance in session 1; dined with the party in session 5.\n\nObsessed with [[Ireena Kolyana|Ireena]].'],
	['ireena', 'person', 'Ireena Kolyana', ['Ireena'], ['ally', 'noble'], 1,
		'Adopted daughter of the late burgomaster of [[Village of Barovia|Barovia]]. Bears two bite marks.'],
	['ismark', 'person', 'Ismark Kolyanovich', ['Ismark the Lesser'], ['ally', 'noble'], 1, "[[Ireena Kolyana|Ireena]]'s brother."],
	['madam-eva', 'person', 'Madam Eva', [], ['vistani', 'seer'], 2,
		'Read the party\'s fortune at [[Tser Pool]]. See [[Tarokka Reading]].'],
	['van-richten', 'person', 'Rudolph van Richten', ['Rictavio'], ['hunter', 'ally'], 4,
		'Posing as a carnival ringmaster in [[Vallaki]]. Knows a great deal about vampires.'],
	['baron', 'person', 'Baron Vargas Vallakovich', ['the Baron'], ['vallaki', 'noble'], 3, 'Holds weekly festivals. Attendance is mandatory.'],
	['urwin', 'person', 'Urwin Martikov', [], ['vallaki', 'wereraven'], 4, 'Keeps the [[Blue Water Inn]]. Secretly one of the [[Keepers of the Feather]].'],
	['sunsword', 'object', 'Sunsword', [], ['artifact', 'weapon'], 2, 'A blade of sunlight. Location foretold by the [[Tarokka Reading]].'],
	['holy-symbol', 'object', 'Holy Symbol of Ravenkind', [], ['artifact'], 2, 'A platinum amulet. Location unknown.'],
	['tome', 'object', 'Tome of Strahd', [], ['artifact', 'book'], 2, "[[Strahd von Zarovich|Strahd]]'s own history, in his hand."],
	['tarokka', 'lore', 'Tarokka Reading', ['the reading', 'fortune'], ['prophecy'], 2,
		'Five cards drawn at [[Tser Pool]]. They name where the [[Sunsword]], the [[Holy Symbol of Ravenkind]] and the [[Tome of Strahd]] lie, and where to face Strahd.'],
	['mists', 'lore', 'The Mists', [], ['barovia', 'curse'], 1, 'Nobody leaves Barovia. Those who try choke and turn back.'],
	['keepers', 'faction', 'Keepers of the Feather', ['wereravens'], ['secret', 'ally'], 5, 'A secret society of wereravens opposed to Strahd.'],
	['vistani', 'faction', 'The Vistani', [], ['vistani'], 2, 'Travellers who can pass through [[The Mists]].']
];

// [from, to, annotation, session]
const EDGES: [string, string, string, number | null][] = [
	['strahd', 'castle', 'rules from', 1],
	['castle', 'village', 'looms over', 1],
	['strahd', 'ireena', 'obsessed with', 1],
	['ismark', 'ireena', 'brother of', 1],
	['ireena', 'village', 'lives in', 1],
	['ismark', 'village', 'lives in', 1],
	['madam-eva', 'tser-pool', 'camps at', 2],
	['madam-eva', 'tarokka', 'performed', 2],
	['tarokka', 'sunsword', 'reveals', 2],
	['tarokka', 'holy-symbol', 'reveals', 2],
	['tarokka', 'tome', 'reveals', 2],
	['strahd', 'tome', 'wrote', 2],
	['madam-eva', 'vistani', 'leads', 2],
	['vistani', 'mists', 'can cross', 2],
	['mists', 'village', 'surround', 1],
	['baron', 'vallaki', 'governs', 3],
	['blue-water', 'vallaki', 'in', 3],
	['urwin', 'blue-water', 'runs', 4],
	['urwin', 'keepers', 'member of', 5],
	['van-richten', 'vallaki', 'hiding in', 4],
	['van-richten', 'strahd', 'hunts', 4],
	['keepers', 'strahd', 'oppose', 5],
	['krezk', 'vallaki', 'road west of', 6],
	['sunsword', 'strahd', 'bane of', null]
];

export function sampleData(): DemoTables {
	const stamp = (id: string, session: number | null) => ({
		id,
		campaign_id: CAMPAIGN,
		session_number: session,
		version: 1,
		created_by: session && session % 2 ? DEMO_USER.id : OTHER.id,
		created_at: T0,
		updated_by: DEMO_USER.id,
		updated_at: T0,
		deleted_at: null
	});

	const nodes: Row[] = NODES.map(([id, type, name, aliases, tags, session, notes]) => ({
		...stamp(id, session),
		type_id: type,
		name,
		aliases,
		tags,
		notes
	}));
	const edges: Row[] = EDGES.map(([from, to, annotation, session], i) => ({
		...stamp(`e${i + 1}`, session),
		from_id: from,
		to_id: to,
		annotation
	}));
	const revisions: Row[] = [...nodes, ...edges].map((row, i) => ({
		id: i + 1,
		campaign_id: CAMPAIGN,
		entity_type: 'from_id' in row ? 'edge' : 'node',
		entity_id: row.id,
		version: 1,
		op: 'create',
		snapshot: { ...row },
		changed_by: row.created_by,
		changed_at: T0
	}));

	return {
		campaigns: [{ id: CAMPAIGN, name: 'Curse of the Mists (demo)', created_by: DEMO_USER.id, created_at: T0 }],
		campaign_members: [
			{ campaign_id: CAMPAIGN, user_id: DEMO_USER.id, role: 'owner', joined_at: T0 },
			{ campaign_id: CAMPAIGN, user_id: OTHER.id, role: 'editor', joined_at: T0 }
		],
		campaign_invites: [],
		profiles: [
			{ id: DEMO_USER.id, display_name: DEMO_USER.name },
			{ id: OTHER.id, display_name: OTHER.name }
		],
		node_types: TYPES.map(([id, label, color], i) => ({ id, campaign_id: CAMPAIGN, label, color, icon: null, sort_order: i })),
		nodes,
		edges,
		revisions
	};
}
