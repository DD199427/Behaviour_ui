"""Behaviour feature definitions and vector builders (schema s1).

Three label-free vectors and one label-derived vector:
  account   bb_profile_vec       a card's normal behaviour (all its transactions up to the as-of date)
  merchant  bb_merchant_vec      a merchant's activity profile
  merchant  bb_merchant_cpp_vec  common-point-of-purchase signal; built from fraud flags (see README)
  txn       bb_txn_vec           one transaction compared with the card's own earlier history

No feature uses a cut-off taken from how the data was generated (fraud hours, test-charge amounts,
fraudster distances). Time of day uses six equal 4-hour bands; "small" and "far" are relative to each
card's own history. Feature order is fixed per schema version; changing it means a new schema version.
"""
import numpy as np

SCHEMA = 's1'

CATEGORIES = [
    'entertainment', 'food_dining', 'gas_transport', 'grocery_net', 'grocery_pos', 'health_fitness', 'home',
    'kids_pets', 'misc_net', 'misc_pos', 'personal_care', 'shopping_net', 'shopping_pos', 'travel'
]
CAT_INDEX = {c: i for i, c in enumerate(CATEGORIES)}
N_CAT = len(CATEGORIES)
HOUR_BANDS = ['00_04', '04_08', '08_12', '12_16', '16_20', '20_24']
N_BANDS = len(HOUR_BANDS)

HOUR = 3600
DAY = 86400

# transaction-vector windows
RECENT_S = 72 * HOUR
BASE_FROM_S = 180 * DAY
BASE_TO_S = 7 * DAY
BASE_DAYS = (BASE_FROM_S - BASE_TO_S) / DAY
MIN_BASELINE_TX = 10

# relative cut-offs: "far" = beyond the card's own 95th-percentile distance from home,
# "small" = below 10% of the card's own median amount
FAR_PERCENTILE = 95
SMALL_FRACTION = 0.10

# merchant common-point-of-purchase window; a setting (--cpp-window-days), not a property of the data
CPP_WINDOW_DAYS = 120

# merchant medians come from fixed-width histograms so partial results from workers merge exactly
AMT_BINS = np.linspace(0, 12, 481)   # log1p(amount)
KM_BINS = np.linspace(0, 9, 361)     # log1p(km)


def configure(cpp_window_days):
    # called in the main process and in every worker so all vectors use the same settings
    global CPP_WINDOW_DAYS
    CPP_WINDOW_DAYS = cpp_window_days


def settings():
    return {
        'hour_bands': HOUR_BANDS,
        'recent_window_hours': RECENT_S // HOUR,
        'baseline_window_days_before': [BASE_FROM_S // DAY, BASE_TO_S // DAY],
        'min_baseline_tx': MIN_BASELINE_TX,
        'far_percentile_of_own_history': FAR_PERCENTILE,
        'small_fraction_of_own_median': SMALL_FRACTION,
        'cpp_window_days': CPP_WINDOW_DAYS,
        'categories': CATEGORIES,
    }


def feature(name, group, scale, description):
    # scale: 'robust' -> (x - median) / IQR at export; 'none' -> kept as is (shares, flags, sin/cos, deltas)
    return {'name': name, 'group': group, 'scale': scale, 'description': description}


def _cat_features(prefix, group, what):
    return [feature(f'{prefix}{c}', group, 'none', f'share of {what} in category {c}') for c in CATEGORIES]


def _band_features(prefix, group, what):
    return [feature(f'{prefix}{b}', group, 'none', f'share of {what} between {b[:2]}:00 and {b[3:]}:00')
            for b in HOUR_BANDS]


ACCOUNT_FEATURES = [
    feature('log_tx_per_active_day', 'activity', 'robust', 'log1p(transactions per day with any activity)'),
    feature('active_day_share', 'activity', 'none', 'days with activity / days from first transaction to as-of date'),
    feature('weekend_share', 'time', 'none', 'share of transactions on Saturday or Sunday'),
    *_band_features('hour_', 'time', 'transactions'),
    *_cat_features('cat_', 'category', 'transactions'),
    feature('online_share', 'category', 'none', 'share of transactions in online (*_net) categories'),
    feature('log_amt_median', 'amount', 'robust', 'log1p(median amount)'),
    feature('log_amt_p90', 'amount', 'robust', 'log1p(90th percentile amount)'),
    feature('amt_log_iqr', 'amount', 'robust', 'log1p(p75 amount) - log1p(p25 amount)'),
    feature('log_km_median', 'location', 'robust', 'log1p(median km from home to merchant)'),
    feature('log_km_p90', 'location', 'robust', 'log1p(90th percentile km from home to merchant)'),
    feature('log_distinct_merchants', 'variety', 'robust', 'log1p(number of distinct merchants)'),
    feature('log_history_days', 'variety', 'robust', 'log1p(days from first transaction to as-of date)'),
]

MERCHANT_FEATURES = [
    *[feature(f'is_{c}', 'category', 'none', f'merchant category is {c}') for c in CATEGORIES],
    feature('is_online', 'category', 'none', 'merchant category is online (*_net)'),
    feature('log_cardholders', 'reach', 'robust', 'log1p(distinct cards with a transaction here)'),
    feature('log_tx', 'reach', 'robust', 'log1p(transactions here)'),
    feature('log_tx_per_cardholder', 'reach', 'robust', 'log1p(transactions per distinct card)'),
    *_band_features('hour_', 'time', 'transactions here'),
    feature('weekend_share', 'time', 'none', 'share of transactions on Saturday or Sunday'),
    feature('log_amt_median', 'amount', 'robust', 'log1p(median amount)'),
    feature('amt_log_iqr', 'amount', 'robust', 'log1p(p75 amount) - log1p(p25 amount)'),
    feature('log_km_median', 'location', 'robust', 'log1p(median km from the cardholder home)'),
    feature('beyond_usual_distance_share', 'location', 'none',
            "share of transactions farther from home than the cardholder's own 95th-percentile distance"),
    feature('active_day_share', 'activity', 'none', 'days with transactions / days from first transaction to as-of date'),
    feature('log_recent_trend', 'activity', 'robust', 'log1p(daily rate in the last 90 days / lifetime daily rate)'),
]

MERCHANT_CPP_FEATURES = [
    feature('victim_visitor_share', 'cpp', 'none',
            'share of distinct cards with a regular purchase here that had a fraud transaction within the cpp window after it'),
    feature('log_victim_visitors', 'cpp', 'robust', 'log1p(number of such cards)'),
    feature('log_median_days_to_fraud', 'cpp', 'robust', 'log1p(median days from the visit here to the first later fraud)'),
]

TXN_FEATURES = [
    # A. the transaction itself
    feature('log_amt', 'A_transaction', 'robust', 'log1p(amount)'),
    feature('amt_z_vs_baseline', 'A_transaction', 'robust', 'z-score of log amount vs the baseline window'),
    feature('tod_sin', 'A_transaction', 'none', 'time of day, sine'),
    feature('tod_cos', 'A_transaction', 'none', 'time of day, cosine'),
    feature('is_online', 'A_transaction', 'none', 'online (*_net) category'),
    feature('category_new_vs_baseline', 'A_transaction', 'none', 'category not seen in the baseline window'),
    feature('hour_rarity', 'A_transaction', 'none', '1 - baseline share of the same 4-hour band'),
    feature('log_km_home', 'A_transaction', 'robust', 'log1p(km from home to merchant)'),
    feature('log_km_baseline_centroid', 'A_transaction', 'robust', 'log1p(km from the centre of baseline merchant locations)'),
    # B. velocity / burst
    feature('log_n_1h', 'B_velocity', 'robust', 'log1p(transactions in the last hour, incl. this one)'),
    feature('log_n_24h', 'B_velocity', 'robust', 'log1p(transactions in the last 24 h, incl. this one)'),
    feature('log_n_72h', 'B_velocity', 'robust', 'log1p(transactions in the last 72 h, incl. this one)'),
    feature('log_velocity_ratio_24h', 'B_velocity', 'robust', 'log1p(24 h count / baseline daily rate)'),
    feature('log_min_gap_min_recent', 'B_velocity', 'robust', 'log1p(smallest gap in minutes between transactions in the last 72 h)'),
    feature('log_median_gap_min_recent', 'B_velocity', 'robust', 'log1p(median gap in minutes between transactions in the last 72 h)'),
    feature('log_spend_ratio_24h', 'B_velocity', 'robust', 'log1p(24 h spend / baseline daily spend)'),
    feature('log_n_small_6h_before', 'B_velocity', 'robust',
            "log1p(charges in the 6 h before this one below 10% of the card's baseline median amount)"),
    # C. recent mix (last 72 h, incl. this one)
    *_cat_features('recent_cat_', 'C_recent_mix', 'transactions in the last 72 h'),
    feature('recent_online_share', 'C_recent_mix', 'none', 'online share in the last 72 h'),
    # D. location (last 72 h)
    feature('log_km_median_recent', 'D_location', 'robust', 'log1p(median km from home, last 72 h)'),
    feature('log_km_max_recent', 'D_location', 'robust', 'log1p(max km from home, last 72 h)'),
    feature('log_km_spread_recent', 'D_location', 'robust', 'log1p(std of km from the centre of last-72 h merchant locations)'),
    feature('beyond_usual_distance_share_recent', 'D_location', 'none',
            "share of last-72 h transactions farther from home than the card's baseline 95th-percentile distance"),
    feature('log_speed_kmh_prev', 'D_location', 'robust', 'log1p(km/h implied by the distance from the previous transaction)'),
    # E. change from the card's normal
    feature('cat_mix_l1_vs_baseline', 'E_change', 'none', 'L1 distance between last-72 h and baseline category mix'),
    feature('hour_mix_l1_vs_baseline', 'E_change', 'none', 'L1 distance between last-72 h and baseline mix of 4-hour bands'),
    feature('recent_share_new_categories', 'E_change', 'none', 'share of last-72 h transactions in categories absent from the baseline'),
    feature('log_ratio_amt_median_vs_baseline', 'E_change', 'robust', 'log1p(median amount last 72 h) - log1p(median amount baseline)'),
    feature('online_share_delta', 'E_change', 'none', 'online share last 72 h - baseline online share'),
    feature('log_ratio_km_median_vs_baseline', 'E_change', 'robust', 'log1p(median km last 72 h) - log1p(median km baseline)'),
    # F. activity
    feature('log_hours_since_prev', 'F_activity', 'robust', 'log1p(hours since the previous transaction)'),
    # H. account context
    feature('age_years', 'H_context', 'robust', 'cardholder age at the transaction'),
    feature('log_city_pop', 'H_context', 'robust', 'log1p(home city population)'),
]

TXN_INDEX = {f['name']: i for i, f in enumerate(TXN_FEATURES)}
BASELINE_DEPENDENT = [TXN_INDEX[n] for n in (
    'amt_z_vs_baseline', 'category_new_vs_baseline', 'hour_rarity', 'log_km_baseline_centroid',
    'log_velocity_ratio_24h', 'log_spend_ratio_24h', 'log_n_small_6h_before', 'beyond_usual_distance_share_recent',
    'cat_mix_l1_vs_baseline', 'hour_mix_l1_vs_baseline', 'recent_share_new_categories',
    'log_ratio_amt_median_vs_baseline', 'online_share_delta', 'log_ratio_km_median_vs_baseline'
)]

assert len(ACCOUNT_FEATURES) == 31 and len(MERCHANT_FEATURES) == 31
assert len(MERCHANT_CPP_FEATURES) == 3 and len(TXN_FEATURES) == 46


def haversine_km(lat1, lon1, lat2, lon2):
    lat1, lon1, lat2, lon2 = map(np.radians, (lat1, lon1, lat2, lon2))
    a = np.sin((lat2 - lat1) / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin((lon2 - lon1) / 2) ** 2
    return 6371.0 * 2 * np.arcsin(np.sqrt(np.clip(a, 0, 1)))


def _cat_shares(cat):
    # categories outside CATEGORIES (cat == -1) count in the total but in no share
    counts = np.bincount(cat[cat >= 0], minlength=N_CAT).astype(float)
    return counts / cat.size if cat.size else counts


def account_vector(c, asof_day):
    # c: one card's arrays (all transactions up to the as-of date), see build_behaviour_vectors.card_arrays
    n = c['ts'].size
    days = np.unique(c['day'])
    span_days = asof_day - days[0] + 1
    amt, km = c['amt'], c['km_home']
    vec = [
        np.log1p(n / days.size),
        days.size / span_days,
        float((c['weekday'] >= 5).mean()),
        *(np.bincount(c['band'], minlength=N_BANDS) / n),
        *_cat_shares(c['cat']),
        float(c['online'].mean()),
        np.log1p(np.median(amt)),
        np.log1p(np.percentile(amt, 90)),
        np.log1p(np.percentile(amt, 75)) - np.log1p(np.percentile(amt, 25)),
        np.log1p(np.median(km)),
        np.log1p(np.percentile(km, 90)),
        np.log1p(np.unique(c['merchant']).size),
        np.log1p(span_days),
    ]
    return np.array(vec, dtype=float), np.zeros(len(vec), dtype=bool)


def hist_quantile(hist, edges, q):
    # quantile from a fixed-width histogram, returned as the centre of the bin holding it
    total = hist.sum()
    if total == 0:
        return np.nan
    idx = min(int(np.searchsorted(np.cumsum(hist), q * total, side='left')), hist.size - 1)
    return (edges[idx] + edges[idx + 1]) / 2


class MerchantAgg:
    """Per-merchant partial counts that merge exactly across workers (each card lives in one input file)."""

    def __init__(self):
        self.n_tx = 0
        self.cardholders = 0
        self.bands = np.zeros(N_BANDS, dtype=np.int64)
        self.weekend = 0
        self.beyond_usual = 0
        self.last90 = 0
        self.amt_hist = np.zeros(AMT_BINS.size - 1, dtype=np.int64)
        self.km_hist = np.zeros(KM_BINS.size - 1, dtype=np.int64)
        self.days = np.zeros(0, dtype=np.int32)
        self.visitors = 0          # distinct cards with a regular (is_fraud = 0) purchase here
        self.victim_visitors = 0   # of those, cards with fraud within the cpp window after a visit here
        self.days_to_fraud = []

    def merge(self, other):
        self.n_tx += other.n_tx
        self.cardholders += other.cardholders
        self.bands += other.bands
        self.weekend += other.weekend
        self.beyond_usual += other.beyond_usual
        self.last90 += other.last90
        self.amt_hist += other.amt_hist
        self.km_hist += other.km_hist
        self.days = np.union1d(self.days, other.days)
        self.visitors += other.visitors
        self.victim_visitors += other.victim_visitors
        self.days_to_fraud.extend(other.days_to_fraud)

    def vectors(self, category, asof_day):
        span_days = asof_day - int(self.days[0]) + 1
        lifetime_rate = self.n_tx / span_days
        vec = np.array([
            *[float(category == c) for c in CATEGORIES],
            float(category.endswith('_net')),
            np.log1p(self.cardholders),
            np.log1p(self.n_tx),
            np.log1p(self.n_tx / self.cardholders),
            *(self.bands / self.n_tx),
            self.weekend / self.n_tx,
            hist_quantile(self.amt_hist, AMT_BINS, 0.5),
            hist_quantile(self.amt_hist, AMT_BINS, 0.75) - hist_quantile(self.amt_hist, AMT_BINS, 0.25),
            hist_quantile(self.km_hist, KM_BINS, 0.5),
            self.beyond_usual / self.n_tx,
            self.days.size / span_days,
            np.log1p((self.last90 / min(90, span_days)) / lifetime_rate),
        ], dtype=float)

        if self.visitors:
            cpp = [self.victim_visitors / self.visitors, np.log1p(self.victim_visitors),
                   np.log1p(np.median(sorted(self.days_to_fraud))) if self.days_to_fraud else np.nan]
        else:
            cpp = [np.nan] * 3
        cpp = np.array(cpp, dtype=float)
        return vec, np.zeros(vec.size, dtype=bool), cpp, np.isnan(cpp)


def card_row_flags(c):
    """Per-transaction inputs to the merchant vectors that depend on the card's own history:
    beyond the card's usual distance from home, and days until the card's next fraud transaction (inf if none)."""
    beyond_usual = c['km_home'] > np.percentile(c['km_home'], FAR_PERCENTILE)
    fraud_ts = c['ts'][c['is_fraud']]
    days_to_fraud = np.full(c['ts'].size, np.inf)
    if fraud_ts.size:
        nxt = np.searchsorted(fraud_ts, c['ts'], side='right')  # first fraud strictly after each transaction
        ok = nxt < fraud_ts.size
        days_to_fraud[ok] = (fraud_ts[nxt[ok]] - c['ts'][ok]) / DAY
    return beyond_usual, days_to_fraud


def _bin(values, edges):
    return np.clip(np.searchsorted(edges, values, side='right') - 1, 0, edges.size - 2)


def merchant_partials(f, n_merchants, asof_day):
    """Per-merchant partial counts for one input file (MerchantAgg per local merchant index).

    f holds one row per transaction: merchant, card, band, weekday, day, amt, km_home, is_fraud,
    beyond_usual and days_to_fraud (from card_row_flags)."""
    m, card = f['merchant'], f['card']
    count = lambda w=None: np.bincount(m, weights=w, minlength=n_merchants)

    n_tx = count()
    cardholders = np.bincount(np.unique(np.stack([m, card]), axis=1)[0], minlength=n_merchants)
    bands = np.zeros((n_merchants, N_BANDS), dtype=np.int64)
    np.add.at(bands, (m, f['band']), 1)
    weekend = count((f['weekday'] >= 5).astype(float))
    beyond = count(f['beyond_usual'].astype(float))
    last90 = count((f['day'] >= asof_day - 89).astype(float))
    amt_hist = np.zeros((n_merchants, AMT_BINS.size - 1), dtype=np.int64)
    np.add.at(amt_hist, (m, _bin(np.log1p(f['amt']), AMT_BINS)), 1)
    km_hist = np.zeros((n_merchants, KM_BINS.size - 1), dtype=np.int64)
    np.add.at(km_hist, (m, _bin(np.log1p(f['km_home']), KM_BINS)), 1)
    md = np.unique(np.stack([m, f['day']]), axis=1)
    day_bounds = np.searchsorted(md[0], np.arange(n_merchants + 1))

    # common point of purchase: distinct cards with a regular purchase here, and how many of them had a
    # fraud transaction within the window after one of those purchases (smallest gap per card)
    legit = ~f['is_fraud']
    lm, lc, lgap = m[legit], card[legit], f['days_to_fraud'][legit]
    order = np.lexsort((lc, lm))
    lm, lc, lgap = lm[order], lc[order], lgap[order]
    starts = np.flatnonzero(np.r_[True, (lm[1:] != lm[:-1]) | (lc[1:] != lc[:-1])])
    pair_m = lm[starts]
    pair_gap = np.minimum.reduceat(lgap, starts) if starts.size else np.zeros(0)
    victim = pair_gap <= CPP_WINDOW_DAYS
    visitors = np.bincount(pair_m, minlength=n_merchants)
    victims = np.bincount(pair_m[victim], minlength=n_merchants)

    aggs = {}
    for j in np.flatnonzero(n_tx):
        agg = MerchantAgg()
        agg.n_tx = int(n_tx[j])
        agg.cardholders = int(cardholders[j])
        agg.bands = bands[j]
        agg.weekend = int(weekend[j])
        agg.beyond_usual = int(beyond[j])
        agg.last90 = int(last90[j])
        agg.amt_hist = amt_hist[j]
        agg.km_hist = km_hist[j]
        agg.days = md[1][day_bounds[j]:day_bounds[j + 1]].astype(np.int32)
        agg.visitors = int(visitors[j])
        agg.victim_visitors = int(victims[j])
        agg.days_to_fraud = pair_gap[(pair_m == j) & victim].tolist()
        aggs[int(j)] = agg
    return aggs


def txn_vectors(c, anchors, dob_day, city_pop):
    """Vectors for the transactions at positions `anchors` (in time order) of one card.

    Every feature uses only this transaction and the card's earlier transactions."""
    ts, amt, cat, band = c['ts'], c['amt'], c['cat'], c['band']
    n = ts.size
    log_amt = np.log1p(amt)
    online = c['online']
    km = c['km_home']
    lat, lon = c['merch_lat'], c['merch_long']

    def cum(x):
        return np.concatenate([np.zeros((1,) + x.shape[1:]), np.cumsum(x, axis=0)])

    onehot = np.zeros((n, N_CAT))
    known = cat >= 0
    onehot[np.flatnonzero(known), cat[known]] = 1
    c_cat, c_online, c_band = cum(onehot), cum(online.astype(float)), cum(np.eye(N_BANDS)[band])
    c_amt, c_lamt, c_lamt2 = cum(amt), cum(log_amt), cum(log_amt ** 2)
    c_lat, c_lon = cum(lat), cum(lon)

    out = np.zeros((anchors.size, len(TXN_FEATURES)))
    mask = np.zeros_like(out, dtype=bool)
    for k, i in enumerate(anchors):
        t = ts[i]
        b_lo = np.searchsorted(ts, t - BASE_FROM_S, 'left')
        b_hi = min(np.searchsorted(ts, t - BASE_TO_S, 'right'), i)
        r_lo = np.searchsorted(ts, t - RECENT_S, 'right')
        h1 = np.searchsorted(ts, t - HOUR, 'right')
        h24 = np.searchsorted(ts, t - DAY, 'right')
        s6 = np.searchsorted(ts, t - 6 * HOUR, 'left')
        nb = b_hi - b_lo
        nr = i - r_lo + 1
        n24 = i - h24 + 1

        r_slice = slice(r_lo, i + 1)
        r_cat = (c_cat[i + 1] - c_cat[r_lo]) / nr
        r_band = (c_band[i + 1] - c_band[r_lo]) / nr
        r_online = (c_online[i + 1] - c_online[r_lo]) / nr
        r_km = km[r_slice]
        r_spread = np.std(haversine_km(lat[r_slice].mean(), lon[r_slice].mean(), lat[r_slice], lon[r_slice]))

        if nb:
            b_cat = (c_cat[b_hi] - c_cat[b_lo]) / nb
            b_has_cat = (c_cat[b_hi] - c_cat[b_lo]) > 0
            b_band = (c_band[b_hi] - c_band[b_lo]) / nb
            b_mean = (c_lamt[b_hi] - c_lamt[b_lo]) / nb
            b_std = np.sqrt(max((c_lamt2[b_hi] - c_lamt2[b_lo]) / nb - b_mean ** 2, 0))
            b_online = (c_online[b_hi] - c_online[b_lo]) / nb
            km_centroid = haversine_km((c_lat[b_hi] - c_lat[b_lo]) / nb, (c_lon[b_hi] - c_lon[b_lo]) / nb, lat[i], lon[i])
            b_amt_med = np.median(amt[b_lo:b_hi])
            b_km_med = np.median(km[b_lo:b_hi])
            b_km_far = np.percentile(km[b_lo:b_hi], FAR_PERCENTILE)
            n_small = np.count_nonzero(amt[s6:i] < SMALL_FRACTION * b_amt_med)
            r_new_share = float((onehot[r_slice] @ ~b_has_cat > 0).mean())
            cat_new = float(cat[i] >= 0 and not b_has_cat[cat[i]])
            beyond_usual = float((r_km > b_km_far).mean())
        else:
            b_cat, b_band = np.zeros(N_CAT), np.zeros(N_BANDS)
            b_mean = b_std = b_online = km_centroid = b_amt_med = b_km_med = 0.0
            n_small = r_new_share = cat_new = beyond_usual = 0.0
        b_daily_rate = nb / BASE_DAYS
        b_daily_spend = (c_amt[b_hi] - c_amt[b_lo]) / BASE_DAYS

        gaps = np.diff(ts[max(r_lo - 1, 0):i + 1]) / 60.0
        has_prev = i > 0
        prev_gap_h = (t - ts[i - 1]) / HOUR if has_prev else 0.0
        speed = haversine_km(lat[i - 1], lon[i - 1], lat[i], lon[i]) / max(prev_gap_h, 1 / 60) if has_prev else 0.0
        tod = c['tod'][i] / DAY * 2 * np.pi

        out[k] = [
            log_amt[i],
            (log_amt[i] - b_mean) / max(b_std, 0.1),
            np.sin(tod), np.cos(tod),
            float(online[i]),
            cat_new,
            1.0 - b_band[band[i]],
            np.log1p(km[i]),
            np.log1p(km_centroid),
            np.log1p(i - h1 + 1),
            np.log1p(n24),
            np.log1p(nr),
            np.log1p(n24 / max(b_daily_rate, 1 / BASE_DAYS)),
            np.log1p(gaps.min()) if gaps.size else 0.0,
            np.log1p(np.median(gaps)) if gaps.size else 0.0,
            np.log1p((c_amt[i + 1] - c_amt[h24]) / max(b_daily_spend, 1.0)),
            np.log1p(n_small),
            *r_cat,
            r_online,
            np.log1p(np.median(r_km)),
            np.log1p(r_km.max()),
            np.log1p(r_spread),
            beyond_usual,
            np.log1p(speed),
            float(np.abs(r_cat - b_cat).sum()),
            float(np.abs(r_band - b_band).sum()),
            r_new_share,
            np.log1p(np.median(amt[r_slice])) - np.log1p(b_amt_med),
            r_online - b_online,
            np.log1p(np.median(r_km)) - np.log1p(b_km_med),
            np.log1p(prev_gap_h),
            (c['day'][i] - dob_day) / 365.25,
            np.log1p(city_pop),
        ]
        if nb < MIN_BASELINE_TX:
            mask[k, BASELINE_DEPENDENT] = True
        if not gaps.size:
            mask[k, [TXN_INDEX['log_min_gap_min_recent'], TXN_INDEX['log_median_gap_min_recent']]] = True
        if not has_prev:
            mask[k, [TXN_INDEX['log_speed_kmh_prev'], TXN_INDEX['log_hours_since_prev']]] = True
    return out, mask
