#define _GNU_SOURCE
#include <cjson/cJSON.h>
#include <ctype.h>
#include <regex.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

static const char *COUNTRIES[20] = {"US", "GB", "DE", "FR", "JP", "BR", "IN", "CN", "CA", "AU", "NO", "SE", "ZA", "NG", "MX", "ES", "IT", "KR", "NL", "PL"};
static const char *LEVELS[4] = {"INFO", "WARN", "ERROR", "DEBUG"};
static const char *RESOURCES[5] = {"users", "orders", "items", "auth", "search"};
static const int STATUSES[6] = {200, 200, 200, 201, 404, 500};

static uint32_t rng_state;
static uint32_t rng_next(void) {
  uint32_t x = rng_state;
  x ^= x << 13;
  x ^= x >> 17;
  x ^= x << 5;
  return rng_state = x;
}
static uint32_t rng_int(uint32_t n) { return rng_next() % n; }

static uint32_t fold(uint32_t h, uint64_t v) { return h * 31u + (uint32_t)v; }
static uint32_t fnv1a(const char *s, size_t len) {
  uint32_t h = 0x811c9dc5u;
  for (size_t i = 0; i < len; i++) h = (h ^ (unsigned char)s[i]) * 0x01000193u;
  return h;
}
static uint64_t now_ns(void) {
  struct timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return (uint64_t)t.tv_sec * 1000000000ull + (uint64_t)t.tv_nsec;
}

typedef struct {
  char *p;
  size_t len, cap;
} Buf;
static void buf_printf(Buf *b, const char *fmt, ...) __attribute__((format(printf, 2, 3)));
#include <stdarg.h>
static void buf_printf(Buf *b, const char *fmt, ...) {
  for (;;) {
    va_list ap;
    va_start(ap, fmt);
    int n = vsnprintf(b->p + b->len, b->cap - b->len, fmt, ap);
    va_end(ap);
    if ((size_t)n < b->cap - b->len) {
      b->len += (size_t)n;
      return;
    }
    b->cap = b->cap * 2 + (size_t)n + 64;
    b->p = realloc(b->p, b->cap);
  }
}

typedef struct {
  uint32_t check;
  int nphases;
  uint64_t phases[4];
} Out;

static int32_t *sort_data;
static int32_t *sort_work;
static size_t sort_n;
static int cmp_i32(const void *a, const void *b) {
  int32_t x = *(const int32_t *)a, y = *(const int32_t *)b;
  return (x > y) - (x < y);
}
static uint32_t sort_gen(size_t n) {
  sort_n = n;
  sort_data = malloc(n * sizeof(int32_t));
  sort_work = malloc(n * sizeof(int32_t));
  uint32_t h = 0;
  for (size_t i = 0; i < n; i++) h = fold(h, (uint32_t)(sort_data[i] = (int32_t)(rng_next() & 0x7fffffff)));
  return h;
}
static void sort_prepare(void) { memcpy(sort_work, sort_data, sort_n * sizeof(int32_t)); }
static void sort_run(Out *o) {
  qsort(sort_work, sort_n, sizeof(int32_t), cmp_i32);
  (void)o;
}
static void sort_check(Out *o) {
  uint32_t h = 0;
  for (size_t i = 0; i < sort_n; i++) h = fold(h, (uint32_t)sort_work[i]);
  o->check = h;
}

static Buf text;
static char *json_out;
static uint32_t json_gen(size_t n) {
  text = (Buf){malloc(n * 110 + 16), 0, n * 110 + 16};
  buf_printf(&text, "[");
  for (size_t i = 0; i < n; i++) {
    const char *country = COUNTRIES[rng_int(20)];
    uint32_t age = 10 + rng_int(80);
    uint32_t score = rng_int(1000);
    int active = (rng_next() & 1) == 1;
    uint32_t t1 = rng_int(10), t2 = rng_int(10);
    buf_printf(&text, "%s{\"id\":%zu,\"name\":\"user_%zu\",\"country\":\"%s\",\"age\":%u,\"score\":%u,\"active\":%s,\"tags\":[\"t%u\",\"t%u\"]}", i ? "," : "", i, i, country, age,
               score, active ? "true" : "false", t1, t2);
  }
  buf_printf(&text, "]");
  return fnv1a(text.p, text.len);
}
static void json_run(Out *o) {
  (void)o;
  cJSON *records = cJSON_Parse(text.p);
  cJSON *out = cJSON_CreateArray();
  cJSON *r;
  cJSON_ArrayForEach(r, records) {
    int score = cJSON_GetObjectItemCaseSensitive(r, "score")->valueint;
    if (!cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(r, "active")) || score < 500) continue;
    const char *name = cJSON_GetObjectItemCaseSensitive(r, "name")->valuestring;
    char upper[64];
    size_t k = 0;
    for (; name[k] && k < sizeof upper - 1; k++) upper[k] = (char)toupper((unsigned char)name[k]);
    upper[k] = 0;
    cJSON *o2 = cJSON_CreateObject();
    cJSON_AddStringToObject(o2, "country", cJSON_GetObjectItemCaseSensitive(r, "country")->valuestring);
    cJSON_AddNumberToObject(o2, "id", cJSON_GetObjectItemCaseSensitive(r, "id")->valueint);
    cJSON_AddStringToObject(o2, "name", upper);
    cJSON_AddNumberToObject(o2, "score2", score * 2);
    cJSON_AddNumberToObject(o2, "tagCount", cJSON_GetArraySize(cJSON_GetObjectItemCaseSensitive(r, "tags")));
    cJSON_AddItemToArray(out, o2);
  }
  json_out = cJSON_PrintUnformatted(out);
  cJSON_Delete(out);
  cJSON_Delete(records);
}
static void json_check(Out *o) {
  o->check = fnv1a(json_out, strlen(json_out));
  free(json_out);
}

static uint64_t str_result[5];
static uint32_t strings_gen(size_t n) {
  text = (Buf){malloc(n * 90 + 16), 0, n * 90 + 16};
  for (size_t i = 0; i < n; i++) {
    const char *level = LEVELS[rng_int(4)];
    uint32_t user = rng_int(1000);
    const char *res = RESOURCES[rng_int(5)];
    uint32_t id = rng_int(10000);
    int status = STATUSES[rng_int(6)];
    uint32_t latency = rng_int(2000);
    buf_printf(&text, "%sts=%zu level=%s user=u%u path=/api/%s/%u status=%d latency=%ums", i ? "\n" : "", 1700000000 + i, level, user, res, id, status, latency);
  }
  return fnv1a(text.p, text.len);
}
static void strings_run(Out *o) {
  (void)o;
  regex_t re;
  regcomp(&re, "status=([0-9]{3}) latency=([0-9]+)ms", REG_EXTENDED);
  uint64_t lines = 0, s5xx = 0, errors = 0, latency = 0, tokens = 0;
  const char *p = text.p, *end = text.p + text.len;
  for (;;) {
    const char *nl = memchr(p, '\n', (size_t)(end - p));
    const char *le = nl ? nl : end;
    size_t len = (size_t)(le - p);
    lines++;
    regmatch_t m[3];
    m[0].rm_so = 0;
    m[0].rm_eo = (regoff_t)len;
    if (regexec(&re, p, 3, m, REG_STARTEND) == 0) {
      if (strtol(p + m[1].rm_so, NULL, 10) >= 500) s5xx++;
      latency += (uint64_t)strtol(p + m[2].rm_so, NULL, 10);
    }
    if (memmem(p, len, "level=ERROR", 11)) errors++;
    uint64_t fields = 1;
    for (size_t i = 0; i < len; i++) fields += p[i] == ' ';
    tokens += fields;
    if (!nl) break;
    p = nl + 1;
  }
  regfree(&re);
  str_result[0] = lines, str_result[1] = s5xx, str_result[2] = errors, str_result[3] = latency & 0xffffffffu, str_result[4] = tokens;
}
static void strings_check(Out *o) {
  uint32_t h = 0;
  for (int i = 0; i < 5; i++) h = fold(h, str_result[i]);
  o->check = h;
}

static size_t sieve_n;
static uint64_t sieve_result[2];
static uint32_t sieve_gen(size_t n) {
  sieve_n = n;
  return (uint32_t)n;
}
static void sieve_run(Out *o) {
  (void)o;
  size_t n = sieve_n;
  unsigned char *composite = calloc(n + 1, 1);
  for (size_t i = 2; i * i <= n; i++)
    if (!composite[i])
      for (size_t j = i * i; j <= n; j += i) composite[j] = 1;
  uint64_t count = 0, sum = 0;
  for (size_t i = 2; i <= n; i++)
    if (!composite[i]) count++, sum += i;
  free(composite);
  sieve_result[0] = count, sieve_result[1] = sum & 0xffffffffu;
}
static void sieve_check(Out *o) { o->check = fold(fold(0, sieve_result[0]), sieve_result[1]); }

typedef struct {
  uint32_t id;
  char name[16];
  const char *country;
  uint32_t age, score, created_at;
} Record;
typedef struct {
  const char *country;
  uint64_t count, sum, max, age_sum;
} Agg;
static Record *recs;
static size_t nrecs;
static Agg groups[20];
static int ngroups;
static uint32_t records_gen(size_t n) {
  nrecs = n;
  recs = malloc(n * sizeof(Record));
  uint32_t h = 0;
  for (size_t i = 0; i < n; i++) {
    uint32_t c = rng_int(20), age = 10 + rng_int(80), score = rng_int(1000), created = 1700000000u + rng_int(31536000);
    recs[i] = (Record){(uint32_t)i, {0}, COUNTRIES[c], age, score, created};
    snprintf(recs[i].name, sizeof recs[i].name, "user_%zu", i);
    h = fold(fold(fold(fold(h, c), age), score), created);
  }
  return h;
}
static int cmp_agg(const void *a, const void *b) {
  const Agg *x = a, *y = b;
  if (x->sum != y->sum) return x->sum < y->sum ? 1 : -1;
  return strcmp(x->country, y->country);
}
static void records_run(Out *o) {
  (void)o;
  const uint32_t cutoff = 1700000000u + 15768000u;
  ngroups = 0;
  for (size_t i = 0; i < nrecs; i++) {
    const Record *r = &recs[i];
    if (r->age < 18 || r->score < 100 || r->created_at < cutoff) continue;
    Agg *g = NULL;
    for (int k = 0; k < ngroups; k++)
      if (groups[k].country == r->country || strcmp(groups[k].country, r->country) == 0) {
        g = &groups[k];
        break;
      }
    if (!g) {
      g = &groups[ngroups++];
      *g = (Agg){r->country, 0, 0, 0, 0};
    }
    g->count++;
    g->sum += r->score;
    if (r->score > g->max) g->max = r->score;
    g->age_sum += r->age;
  }
  qsort(groups, (size_t)ngroups, sizeof(Agg), cmp_agg);
}
static void records_check(Out *o) {
  uint32_t h = 0;
  for (int k = 0; k < ngroups; k++) {
    h = fold(h, fnv1a(groups[k].country, strlen(groups[k].country)));
    h = fold(h, groups[k].count);
    h = fold(h, groups[k].sum & 0xffffffffu);
    h = fold(h, groups[k].max);
    h = fold(h, groups[k].age_sum & 0xffffffffu);
  }
  o->check = h;
}

static int32_t *keys, *queries, *sorted_keys;
static size_t nkeys;
static uint64_t search_result[3];
static uint32_t search_gen(size_t n) {
  nkeys = n;
  keys = malloc(n * sizeof(int32_t));
  queries = malloc(n * sizeof(int32_t));
  sorted_keys = malloc(n * sizeof(int32_t));
  uint32_t h = 0;
  for (size_t i = 0; i < n; i++) h = fold(h, (uint32_t)(keys[i] = (int32_t)(rng_next() & 0x7fffffff)));
  for (size_t i = 0; i < n; i++) {
    queries[i] = (i & 1) == 0 ? keys[rng_int((uint32_t)n)] : (int32_t)(rng_next() & 0x7fffffff);
    h = fold(h, (uint32_t)queries[i]);
  }
  return h;
}
static void search_run(Out *o) {
  uint64_t t = now_ns(), t2;
  size_t cap = 16;
  while (cap < nkeys * 2) cap <<= 1;
  int32_t *slot_key = malloc(cap * sizeof(int32_t));
  uint32_t *slot_val = malloc(cap * sizeof(uint32_t));
  memset(slot_key, 0xff, cap * sizeof(int32_t));
  for (size_t i = 0; i < nkeys; i++) {
    size_t s = ((uint32_t)keys[i] * 2654435761u) & (cap - 1);
    while (slot_key[s] != -1 && slot_key[s] != keys[i]) s = (s + 1) & (cap - 1);
    slot_key[s] = keys[i];
    slot_val[s] = (uint32_t)i;
  }
  o->phases[0] = (t2 = now_ns()) - t, t = t2;

  uint64_t hits = 0, sum = 0;
  for (size_t i = 0; i < nkeys; i++) {
    size_t s = ((uint32_t)queries[i] * 2654435761u) & (cap - 1);
    while (slot_key[s] != -1) {
      if (slot_key[s] == queries[i]) {
        hits++;
        sum += slot_val[s];
        break;
      }
      s = (s + 1) & (cap - 1);
    }
  }
  o->phases[1] = (t2 = now_ns()) - t, t = t2;

  memcpy(sorted_keys, keys, nkeys * sizeof(int32_t));
  qsort(sorted_keys, nkeys, sizeof(int32_t), cmp_i32);
  o->phases[2] = (t2 = now_ns()) - t, t = t2;

  uint64_t bin_hits = 0;
  for (size_t i = 0; i < nkeys; i++)
    if (bsearch(&queries[i], sorted_keys, nkeys, sizeof(int32_t), cmp_i32)) bin_hits++;
  o->phases[3] = now_ns() - t;
  o->nphases = 4;
  free(slot_key);
  free(slot_val);
  search_result[0] = hits, search_result[1] = sum & 0xffffffffu, search_result[2] = bin_hits;
}
static void search_check(Out *o) { o->check = fold(fold(fold(0, search_result[0]), search_result[1]), search_result[2]); }

static const char *REGIONS[8] = {"NA", "EMEA", "APAC", "LATAM", "ANZ", "MEA", "NORDICS", "DACH"};

typedef struct {
  char region[8];
  int month;
  uint64_t orders, units, revenue;
} CsvGroup;
#define CSV_SLOTS 256
static CsvGroup csv_groups[CSV_SLOTS];
static CsvGroup *csv_rows[CSV_SLOTS];
static int csv_nrows;
static Buf csv_report;
static uint32_t csv_gen(size_t n) {
  text = (Buf){malloc(n * 48 + 64), 0, n * 48 + 64};
  buf_printf(&text, "order_id,date,region,sku,qty,unit_price_cents,discount_pct");
  for (size_t i = 0; i < n; i++) {
    uint32_t month = 1 + rng_int(12), day = 1 + rng_int(28);
    const char *region = REGIONS[rng_int(8)];
    uint32_t sku = rng_int(1000), qty = 1 + rng_int(20), price = 99 + rng_int(99901), discount = 5 * rng_int(5);
    buf_printf(&text, "\n%zu,2026-%02u-%02u,%s,SKU-%u,%u,%u,%u", i, month, day, region, sku, qty, price, discount);
  }
  return fnv1a(text.p, text.len);
}
static int cmp_csv(const void *a, const void *b) {
  const CsvGroup *x = *(CsvGroup *const *)a, *y = *(CsvGroup *const *)b;
  int c = strcmp(x->region, y->region);
  return c ? c : x->month - y->month;
}
static void csv_run(Out *o) {
  (void)o;
  csv_nrows = 0;
  for (int k = 0; k < CSV_SLOTS; k++) csv_groups[k].month = 0;
  const char *p = text.p, *end = text.p + text.len;
  p = memchr(p, '\n', (size_t)(end - p));
  while (p) {
    p++;
    const char *nl = memchr(p, '\n', (size_t)(end - p));
    const char *date = memchr(p, ',', (size_t)(end - p)) + 1;
    const char *region = memchr(date, ',', (size_t)(end - date)) + 1;
    const char *sku = memchr(region, ',', (size_t)(end - region)) + 1;
    size_t rlen = (size_t)(sku - 1 - region);
    char *e;
    strtol(sku + 4, &e, 10);
    long qty = strtol(e + 1, &e, 10);
    long price = strtol(e + 1, &e, 10);
    long discount = strtol(e + 1, &e, 10);
    int month = (date[5] - '0') * 10 + (date[6] - '0');
    uint64_t revenue = (uint64_t)(qty * price * (100 - discount) / 100);
    uint32_t s = fold(fnv1a(region, rlen), (uint64_t)month) & (CSV_SLOTS - 1);
    while (csv_groups[s].month && !(csv_groups[s].month == month && strlen(csv_groups[s].region) == rlen && memcmp(csv_groups[s].region, region, rlen) == 0))
      s = (s + 1) & (CSV_SLOTS - 1);
    CsvGroup *g = &csv_groups[s];
    if (!g->month) {
      memcpy(g->region, region, rlen);
      g->region[rlen] = 0;
      g->month = month;
      g->orders = g->units = g->revenue = 0;
      csv_rows[csv_nrows++] = g;
    }
    g->orders++;
    g->units += (uint64_t)qty;
    g->revenue += revenue;
    p = nl;
  }
  qsort(csv_rows, (size_t)csv_nrows, sizeof(CsvGroup *), cmp_csv);
  csv_report = (Buf){malloc(4096), 0, 4096};
  buf_printf(&csv_report, "region,month,orders,units,revenue_cents");
  for (int k = 0; k < csv_nrows; k++) {
    const CsvGroup *g = csv_rows[k];
    buf_printf(&csv_report, "\n%s,2026-%02d,%llu,%llu,%llu", g->region, g->month, (unsigned long long)g->orders, (unsigned long long)g->units, (unsigned long long)g->revenue);
  }
}
static void csv_check(Out *o) {
  o->check = fnv1a(csv_report.p, csv_report.len);
  free(csv_report.p);
}

static int32_t *values;
static size_t nvalues;
static uint64_t metrics_result[8];
static uint32_t metrics_gen(size_t n) {
  nvalues = n;
  values = malloc(n * sizeof(int32_t));
  uint32_t h = 0;
  for (size_t i = 0; i < n; i++) {
    uint32_t v = 20 + rng_int(80);
    if (rng_int(100) < 3) v += 200 + rng_int(800);
    values[i] = (int32_t)v;
    h = fold(h, v);
  }
  return h;
}
static void metrics_run(Out *o) {
  (void)o;
  size_t n = nvalues;
  uint64_t window = 0, slow = 0, peak = 0, total = 0;
  for (size_t i = 0; i < n; i++) {
    window += (uint64_t)values[i];
    total += (uint64_t)values[i];
    if (i >= 60) window -= (uint64_t)values[i - 60];
    if (i >= 59) {
      if (window > 7200) slow++;
      if (window > peak) peak = window;
    }
  }
  uint32_t buckets = 0;
  for (size_t start = 0; start < n; start += 60) {
    int32_t max = 0;
    for (size_t i = start; i < start + 60 && i < n; i++)
      if (values[i] > max) max = values[i];
    buckets = fold(buckets, (uint64_t)max);
  }
  int32_t *sorted = malloc(n * sizeof(int32_t));
  memcpy(sorted, values, n * sizeof(int32_t));
  qsort(sorted, n, sizeof(int32_t), cmp_i32);
  metrics_result[0] = slow, metrics_result[1] = peak, metrics_result[2] = buckets;
  metrics_result[3] = (uint64_t)sorted[(50 * n + 99) / 100 - 1];
  metrics_result[4] = (uint64_t)sorted[(95 * n + 99) / 100 - 1];
  metrics_result[5] = (uint64_t)sorted[(99 * n + 99) / 100 - 1];
  metrics_result[6] = (uint64_t)sorted[n - 1];
  metrics_result[7] = (total * 1000 / n) & 0xffffffffu;
  free(sorted);
}
static void metrics_check(Out *o) {
  uint32_t h = 0;
  for (int i = 0; i < 8; i++) h = fold(h, metrics_result[i]);
  o->check = h;
}

#define NN_IN 64
#define NN_H 64
#define NN_OUT 10
static int32_t nn_w1[NN_H][NN_IN], nn_b1[NN_H], nn_w2[NN_H][NN_H], nn_b2[NN_H], nn_w3[NN_OUT][NN_H], nn_b3[NN_OUT];
static int32_t (*nn_x)[NN_IN];
static size_t nn_n;
static uint64_t infer_result[2];
static uint32_t nn_hash;
static void nn_draw(int32_t *out, size_t count, uint32_t k, int32_t offset) {
  for (size_t i = 0; i < count; i++) {
    uint32_t raw = rng_int(k);
    nn_hash = fold(nn_hash, raw);
    out[i] = (int32_t)raw - offset;
  }
}
static uint32_t infer_gen(size_t n) {
  nn_n = n;
  nn_hash = 0;
  nn_draw(&nn_w1[0][0], NN_H * NN_IN, 255, 127), nn_draw(nn_b1, NN_H, 2001, 1000);
  nn_draw(&nn_w2[0][0], NN_H * NN_H, 255, 127), nn_draw(nn_b2, NN_H, 2001, 1000);
  nn_draw(&nn_w3[0][0], NN_OUT * NN_H, 255, 127), nn_draw(nn_b3, NN_OUT, 2001, 1000);
  nn_x = malloc(n * sizeof *nn_x);
  nn_draw(&nn_x[0][0], n * NN_IN, 256, 128);
  return nn_hash;
}
static void nn_dense(const int32_t *w, const int32_t *b, const int32_t *in, int in_len, int32_t *out, int out_len) {
  for (int j = 0; j < out_len; j++) {
    int32_t a = b[j];
    for (int k = 0; k < in_len; k++) a += w[j * in_len + k] * in[k];
    out[j] = a;
  }
}
static int32_t nn_relu(int32_t v) {
  v = (v > 0 ? v : 0) / 1024;
  return v < 127 ? v : 127;
}
static void infer_run(Out *o) {
  (void)o;
  int32_t h1[NN_H], h2[NN_H], logits[NN_OUT];
  uint32_t preds = 0, conf = 0;
  for (size_t s = 0; s < nn_n; s++) {
    nn_dense(&nn_w1[0][0], nn_b1, nn_x[s], NN_IN, h1, NN_H);
    for (int j = 0; j < NN_H; j++) h1[j] = nn_relu(h1[j]);
    nn_dense(&nn_w2[0][0], nn_b2, h1, NN_H, h2, NN_H);
    for (int j = 0; j < NN_H; j++) h2[j] = nn_relu(h2[j]);
    nn_dense(&nn_w3[0][0], nn_b3, h2, NN_H, logits, NN_OUT);
    int pred = 0;
    for (int k = 1; k < NN_OUT; k++)
      if (logits[k] > logits[pred]) pred = k;
    preds = fold(preds, (uint64_t)pred);
    conf += (uint32_t)(logits[pred] + 4194304);
  }
  infer_result[0] = preds, infer_result[1] = conf;
}
static void infer_check(Out *o) { o->check = fold(fold(0, infer_result[0]), infer_result[1]); }

#define EMB_D 64
#define EMB_Q 8
#define EMB_K 10
typedef struct {
  int32_t score, index;
} Scored;
static int32_t (*emb_docs)[EMB_D], emb_queries[EMB_Q][EMB_D];
static size_t emb_n;
static Scored *emb_ranked;
static uint64_t emb_results[2 * EMB_Q * EMB_K];
static uint32_t embed_gen(size_t n) {
  emb_n = n;
  emb_docs = malloc(n * sizeof *emb_docs);
  emb_ranked = malloc(n * sizeof(Scored));
  uint32_t h = 0;
  for (size_t d = 0; d < n; d++)
    for (int k = 0; k < EMB_D; k++) {
      uint32_t raw = rng_int(256);
      h = fold(h, raw);
      emb_docs[d][k] = (int32_t)raw - 128;
    }
  for (int q = 0; q < EMB_Q; q++)
    for (int k = 0; k < EMB_D; k++) {
      uint32_t raw = rng_int(256);
      h = fold(h, raw);
      emb_queries[q][k] = (int32_t)raw - 128;
    }
  return h;
}
static int cmp_scored(const void *a, const void *b) {
  const Scored *x = a, *y = b;
  if (x->score != y->score) return x->score < y->score ? 1 : -1;
  return (x->index > y->index) - (x->index < y->index);
}
static void embed_run(Out *o) {
  (void)o;
  size_t r = 0;
  for (int q = 0; q < EMB_Q; q++) {
    for (size_t d = 0; d < emb_n; d++) {
      int32_t s = 0;
      for (int k = 0; k < EMB_D; k++) s += emb_docs[d][k] * emb_queries[q][k];
      emb_ranked[d] = (Scored){s, (int32_t)d};
    }
    qsort(emb_ranked, emb_n, sizeof(Scored), cmp_scored);
    for (int k = 0; k < EMB_K; k++) emb_results[r++] = (uint64_t)emb_ranked[k].index, emb_results[r++] = (uint64_t)(emb_ranked[k].score + 2097152);
  }
}
static void embed_check(Out *o) {
  uint32_t h = 0;
  for (size_t i = 0; i < 2 * EMB_Q * EMB_K; i++) h = fold(h, emb_results[i]);
  o->check = h;
}

static unsigned char *img_rgb;
static size_t img_n;
static uint64_t img_hist[256], img_edges;
static uint32_t pixel_gen(size_t n) {
  img_n = n;
  img_rgb = malloc(n * n * 3);
  uint32_t h = 0;
  for (size_t y = 0; y < n; y++)
    for (size_t x = 0; x < n; x++) {
      size_t p = (y * n + x) * 3;
      img_rgb[p] = (unsigned char)((x + y + rng_int(64)) % 256);
      img_rgb[p + 1] = (unsigned char)((2 * x + rng_int(64)) % 256);
      img_rgb[p + 2] = (unsigned char)((2 * y + rng_int(64)) % 256);
      h = fold(fold(fold(h, img_rgb[p]), img_rgb[p + 1]), img_rgb[p + 2]);
    }
  return h;
}
static size_t clamp_idx(long v, size_t n) { return v < 0 ? 0 : (size_t)v >= n ? n - 1 : (size_t)v; }
static void pixel_run(Out *o) {
  uint64_t t = now_ns(), t2;
  size_t n = img_n;
  unsigned char *gray = malloc(n * n), *blur = malloc(n * n), *mag = malloc(n * n);
  for (size_t i = 0; i < n * n; i++) gray[i] = (unsigned char)((77 * img_rgb[i * 3] + 150 * img_rgb[i * 3 + 1] + 29 * img_rgb[i * 3 + 2]) / 256);
  o->phases[0] = (t2 = now_ns()) - t, t = t2;

  for (size_t y = 0; y < n; y++) {
    size_t ru = clamp_idx((long)y - 1, n) * n, r0 = y * n, rd = clamp_idx((long)y + 1, n) * n;
    for (size_t x = 0; x < n; x++) {
      size_t xl = clamp_idx((long)x - 1, n), xr = clamp_idx((long)x + 1, n);
      int s = gray[ru + xl] + 2 * gray[ru + x] + gray[ru + xr] + 2 * gray[r0 + xl] + 4 * gray[r0 + x] + 2 * gray[r0 + xr] + gray[rd + xl] + 2 * gray[rd + x] + gray[rd + xr];
      blur[r0 + x] = (unsigned char)(s / 16);
    }
  }
  o->phases[1] = (t2 = now_ns()) - t, t = t2;

  for (size_t y = 0; y < n; y++) {
    size_t ru = clamp_idx((long)y - 1, n) * n, r0 = y * n, rd = clamp_idx((long)y + 1, n) * n;
    for (size_t x = 0; x < n; x++) {
      size_t xl = clamp_idx((long)x - 1, n), xr = clamp_idx((long)x + 1, n);
      int gx = blur[ru + xr] + 2 * blur[r0 + xr] + blur[rd + xr] - (blur[ru + xl] + 2 * blur[r0 + xl] + blur[rd + xl]);
      int gy = blur[rd + xl] + 2 * blur[rd + x] + blur[rd + xr] - (blur[ru + xl] + 2 * blur[ru + x] + blur[ru + xr]);
      int m = abs(gx) + abs(gy);
      mag[r0 + x] = (unsigned char)(m > 255 ? 255 : m);
    }
  }
  o->phases[2] = (t2 = now_ns()) - t, t = t2;

  memset(img_hist, 0, sizeof img_hist);
  img_edges = 0;
  for (size_t i = 0; i < n * n; i++) {
    img_hist[mag[i]]++;
    if (mag[i] >= 128) img_edges++;
  }
  o->phases[3] = now_ns() - t;
  o->nphases = 4;
  free(gray);
  free(blur);
  free(mag);
}
static void pixel_check(Out *o) {
  uint32_t h = 0;
  for (int i = 0; i < 256; i++) h = fold(h, img_hist[i]);
  o->check = fold(h, img_edges);
}

typedef struct {
  const char *name;
  uint32_t (*gen)(size_t);
  void (*prepare)(void);
  void (*run)(Out *);
  void (*check)(Out *);
} Challenge;
static void noop(void) {}
static const Challenge CHALLENGES[] = {
    {"sort", sort_gen, sort_prepare, sort_run, sort_check},           {"json", json_gen, noop, json_run, json_check},
    {"strings", strings_gen, noop, strings_run, strings_check},       {"sieve", sieve_gen, noop, sieve_run, sieve_check},
    {"records", records_gen, noop, records_run, records_check},       {"search", search_gen, noop, search_run, search_check},
    {"csv", csv_gen, noop, csv_run, csv_check},                       {"metrics", metrics_gen, noop, metrics_run, metrics_check},
    {"infer", infer_gen, noop, infer_run, infer_check},               {"embed", embed_gen, noop, embed_run, embed_check},
    {"pixel", pixel_gen, noop, pixel_run, pixel_check},
};

int main(int argc, char **argv) {
  setvbuf(stdout, NULL, _IOLBF, 0);
  printf("{\"e\":\"hello\",\"lang\":\"c\"}\n");
  if (argc < 6) {
    printf("{\"e\":\"error\",\"msg\":\"usage: harness <challenge> <size> <seed> <warmup> <runs>\"}\n");
    return 1;
  }
  const Challenge *c = NULL;
  for (size_t i = 0; i < sizeof CHALLENGES / sizeof *CHALLENGES; i++)
    if (strcmp(CHALLENGES[i].name, argv[1]) == 0) c = &CHALLENGES[i];
  if (!c) {
    printf("{\"e\":\"error\",\"msg\":\"unknown challenge: %s\"}\n", argv[1]);
    return 1;
  }
  size_t size = strtoull(argv[2], NULL, 10);
  rng_state = (uint32_t)strtoull(argv[3], NULL, 10);
  if (rng_state == 0) rng_state = 0x9e3779b9u;
  int warmup = atoi(argv[4]), runs = atoi(argv[5]);

  uint64_t g0 = now_ns();
  uint32_t hash = c->gen(size);
  printf("{\"e\":\"ready\",\"genNs\":%llu,\"input\":\"%08x\",\"ops\":%zu}\n", (unsigned long long)(now_ns() - g0), hash, strcmp(c->name, "search") == 0 ? size * 2 : strcmp(c->name, "embed") == 0 ? size * EMB_Q : strcmp(c->name, "pixel") == 0 ? size * size : size);

  for (int i = 0; i < warmup + runs; i++) {
    Out o = {0};
    c->prepare();
    uint64_t t0 = now_ns();
    c->run(&o);
    uint64_t ns = now_ns() - t0;
    c->check(&o);
    int warm = i < warmup;
    printf("{\"e\":\"%s\",\"i\":%d,\"ns\":%llu,\"check\":\"%08x\"", warm ? "warmup" : "run", warm ? i : i - warmup, (unsigned long long)ns, o.check);
    if (o.nphases) printf(",\"phases\":[%llu,%llu,%llu,%llu]", (unsigned long long)o.phases[0], (unsigned long long)o.phases[1], (unsigned long long)o.phases[2], (unsigned long long)o.phases[3]);
    printf("}\n");
  }
  printf("{\"e\":\"done\"}\n");
  return 0;
}
