/*
 * The calendar of blz's whispers.
 *
 * The twelve XM modules are the originals from the 2002 release.
 * Durations were read from the modules with libopenmpt (via ffprobe)
 * and are only used before the first onMetadata event arrives.
 */

export const SEASONS = {
  spring: {
    id: 'spring',
    numeral: 'I',
    name: 'spring',
    range: 'march — may',
    tagline: 'thaw · blossom · birdsong',
    image: 'assets/art/spring.jpg',
    alt: 'Spring painting: a robin on a branch above a sunlit green clearing, with a small figure walking by a bench.',
    accent: '#d7e2a7',
    accentSoft: 'rgba(215, 226, 167, 0.24)',
    months: ['march', 'april', 'may'],
  },
  summer: {
    id: 'summer',
    numeral: 'II',
    name: 'summer',
    range: 'june — august',
    tagline: 'sun · haze · fireflies',
    image: 'assets/art/summer.jpg',
    alt: 'Summer painting: a figure with a walking stick standing in a hazy field at sunset.',
    accent: '#f2bd85',
    accentSoft: 'rgba(242, 189, 133, 0.24)',
    months: ['june', 'july', 'august'],
  },
  fall: {
    id: 'fall',
    numeral: 'III',
    name: 'fall',
    range: 'september — november',
    tagline: 'leaves · dusk · rain',
    image: 'assets/art/fall.jpg',
    alt: 'Fall painting: a lone figure on a path through a forest of red leaves, with a bench nearby.',
    accent: '#dfa05c',
    accentSoft: 'rgba(223, 160, 92, 0.24)',
    months: ['september', 'october', 'november'],
  },
  winter: {
    id: 'winter',
    numeral: 'IV',
    name: 'winter',
    range: 'december — february',
    tagline: 'snow · stillness · embers',
    image: 'assets/art/winter.jpg',
    alt: 'Winter painting: a bundled figure with a walking stick sitting on a snowy bench.',
    accent: '#c7dfea',
    accentSoft: 'rgba(199, 223, 234, 0.24)',
    months: ['december', 'january', 'february'],
  },
};

// The order of the four stripes in the original menu.
export const SEASON_ORDER = ['spring', 'summer', 'fall', 'winter'];

// A calendar year, January first. Each entry points back at its season.
export const MONTHS = [
  {
    index: 0,
    number: '01',
    name: 'January',
    slug: 'january',
    season: 'winter',
    file: 'assets/music/january.xm',
    duration: 217.59,
    channels: 24,
    instruments: 12,
  },
  {
    index: 1,
    number: '02',
    name: 'February',
    slug: 'february',
    season: 'winter',
    file: 'assets/music/february.xm',
    duration: 209.76,
    channels: 20,
    instruments: 16,
  },
  {
    index: 2,
    number: '03',
    name: 'March',
    slug: 'march',
    season: 'spring',
    file: 'assets/music/march.xm',
    duration: 162.8,
    channels: 30,
    instruments: 19,
  },
  {
    index: 3,
    number: '04',
    name: 'April',
    slug: 'april',
    season: 'spring',
    file: 'assets/music/april.xm',
    duration: 220.34,
    channels: 26,
    instruments: 15,
  },
  {
    index: 4,
    number: '05',
    name: 'May',
    slug: 'may',
    season: 'spring',
    file: 'assets/music/may.xm',
    duration: 153.92,
    channels: 28,
    instruments: 25,
  },
  {
    index: 5,
    number: '06',
    name: 'June',
    slug: 'june',
    season: 'summer',
    file: 'assets/music/june.xm',
    duration: 148.64,
    channels: 24,
    instruments: 12,
  },
  {
    index: 6,
    number: '07',
    name: 'July',
    slug: 'july',
    season: 'summer',
    file: 'assets/music/july.xm',
    duration: 153.28,
    channels: 14,
    instruments: 9,
  },
  {
    index: 7,
    number: '08',
    name: 'August',
    slug: 'august',
    season: 'summer',
    file: 'assets/music/august.xm',
    duration: 189.28,
    channels: 24,
    instruments: 11,
  },
  {
    index: 8,
    number: '09',
    name: 'September',
    slug: 'september',
    season: 'fall',
    file: 'assets/music/september.xm',
    duration: 210.07,
    channels: 30,
    instruments: 17,
  },
  {
    index: 9,
    number: '10',
    name: 'October',
    slug: 'october',
    season: 'fall',
    file: 'assets/music/october.xm',
    duration: 188.02,
    channels: 20,
    instruments: 17,
  },
  {
    index: 10,
    number: '11',
    name: 'November',
    slug: 'november',
    season: 'fall',
    file: 'assets/music/november.xm',
    duration: 156.18,
    channels: 30,
    instruments: 15,
  },
  {
    index: 11,
    number: '12',
    name: 'December',
    slug: 'december',
    season: 'winter',
    file: 'assets/music/december.xm',
    duration: 145.44,
    channels: 24,
    instruments: 16,
  },
];

export const MONTHS_BY_SLUG = Object.fromEntries(MONTHS.map((month) => [month.slug, month]));

export const TOTAL_SECONDS = MONTHS.reduce((sum, month) => sum + month.duration, 0);

export function getMonth(index) {
  const normalized = ((Math.trunc(index) % MONTHS.length) + MONTHS.length) % MONTHS.length;
  return MONTHS[normalized];
}

export function getSeason(id) {
  return SEASONS[id];
}

export function seasonForMonth(month) {
  return SEASONS[month.season];
}

export function firstMonthOfSeason(seasonId) {
  const season = SEASONS[seasonId];
  return MONTHS_BY_SLUG[season.months[0]];
}

export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const whole = Math.floor(seconds);
  const mins = Math.floor(whole / 60);
  const secs = whole % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function formatLongDuration(seconds) {
  const mins = Math.round(seconds / 60);
  return `${mins} min`;
}
