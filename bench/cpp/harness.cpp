#include <nlohmann/json.hpp>

#include <algorithm>
#include <array>
#include <charconv>
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <functional>
#include <map>
#include <numeric>
#include <regex>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

using json = nlohmann::json;
using Clock = std::chrono::steady_clock;

namespace {

const char* COUNTRIES[20] = {"US", "GB", "DE", "FR", "JP", "BR", "IN", "CN", "CA", "AU", "NO", "SE", "ZA", "NG", "MX", "ES", "IT", "KR", "NL", "PL"};
const char* LEVELS[4] = {"INFO", "WARN", "ERROR", "DEBUG"};
const char* RESOURCES[5] = {"users", "orders", "items", "auth", "search"};
const int STATUSES[6] = {200, 200, 200, 201, 404, 500};

struct Rng {
  uint32_t s;
  explicit Rng(uint64_t seed) : s(static_cast<uint32_t>(seed) ? static_cast<uint32_t>(seed) : 0x9e3779b9u) {}
  uint32_t next() {
    uint32_t x = s;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    return s = x;
  }
  uint32_t uint(uint32_t n) { return next() % n; }
};

uint32_t fold(uint32_t h, uint64_t v) { return h * 31u + static_cast<uint32_t>(v); }
uint32_t fnv1a(std::string_view s) {
  uint32_t h = 0x811c9dc5u;
  for (unsigned char c : s) h = (h ^ c) * 0x01000193u;
  return h;
}
uint32_t fold_all(const std::vector<uint64_t>& v) {
  uint32_t h = 0;
  for (auto x : v) h = fold(h, x);
  return h;
}
uint64_t elapsed(Clock::time_point a, Clock::time_point b) { return static_cast<uint64_t>(std::chrono::duration_cast<std::chrono::nanoseconds>(b - a).count()); }

struct Out {
  uint32_t check = 0;
  std::vector<uint64_t> phases;
};

struct Challenge {
  std::function<uint32_t(size_t, Rng&)> gen;
  std::function<void()> prepare;
  std::function<void(Out&)> run;
  std::function<void(Out&)> check;
};

std::vector<int32_t> sort_data, sort_work;

std::string text, json_result;
std::vector<uint64_t> counters;
size_t sieve_n = 0;

struct Record {
  uint32_t id;
  std::string name;
  std::string country;
  uint32_t age, score, created_at;
};
struct Agg {
  std::string country;
  uint64_t count = 0, sum = 0, max = 0, age_sum = 0;
};
std::vector<Record> records;
std::vector<Agg> groups_sorted;

std::vector<int32_t> keys, queries;

const char* REGIONS[8] = {"NA", "EMEA", "APAC", "LATAM", "ANZ", "MEA", "NORDICS", "DACH"};
struct CsvGroup {
  uint64_t orders = 0, units = 0, revenue = 0;
};
std::string csv_report;

std::vector<int32_t> values;

constexpr size_t NN_IN = 64, NN_H = 64, NN_OUT = 10;
struct Mlp {
  std::vector<int32_t> w1, b1, w2, b2, w3, b3, x;
  size_t n = 0;
};
Mlp mlp;

constexpr size_t EMB_D = 64, EMB_Q = 8, EMB_K = 10;
std::vector<int32_t> docs, emb_queries;
size_t emb_n = 0;

std::vector<uint8_t> rgb;
size_t img_n = 0;

std::map<std::string, Challenge> challenges() {
  std::map<std::string, Challenge> m;
  auto none = [] {};

  m["sort"] = {[](size_t n, Rng& r) {
                 sort_data.resize(n);
                 uint32_t h = 0;
                 for (auto& v : sort_data) h = fold(h, static_cast<uint32_t>(v = static_cast<int32_t>(r.next() & 0x7fffffff)));
                 return h;
               },
               [] { sort_work = sort_data; }, [](Out&) { std::sort(sort_work.begin(), sort_work.end()); },
               [](Out& o) {
                 uint32_t h = 0;
                 for (auto v : sort_work) h = fold(h, static_cast<uint32_t>(v));
                 o.check = h;
               }};

  m["json"] = {[](size_t n, Rng& r) {
                 text.clear();
                 text.reserve(n * 110);
                 text += '[';
                 char buf[256];
                 for (size_t i = 0; i < n; i++) {
                   const char* country = COUNTRIES[r.uint(20)];
                   uint32_t age = 10 + r.uint(80), score = r.uint(1000);
                   bool active = (r.next() & 1) == 1;
                   uint32_t t1 = r.uint(10), t2 = r.uint(10);
                   std::snprintf(buf, sizeof buf, "%s{\"id\":%zu,\"name\":\"user_%zu\",\"country\":\"%s\",\"age\":%u,\"score\":%u,\"active\":%s,\"tags\":[\"t%u\",\"t%u\"]}", i ? "," : "", i, i,
                                 country, age, score, active ? "true" : "false", t1, t2);
                   text += buf;
                 }
                 text += ']';
                 return fnv1a(text);
               },
               none,
               [](Out&) {
                 json records = json::parse(text);
                 json out = json::array();
                 for (const auto& r : records) {
                   int score = r["score"].get<int>();
                   if (!r["active"].get<bool>() || score < 500) continue;
                   std::string name = r["name"].get<std::string>();
                   std::transform(name.begin(), name.end(), name.begin(), [](unsigned char c) { return static_cast<char>(std::toupper(c)); });
                   out.push_back({{"id", r["id"]}, {"name", name}, {"country", r["country"]}, {"score2", score * 2}, {"tagCount", r["tags"].size()}});
                 }
                 json_result = out.dump();
               },
               [](Out& o) { o.check = fnv1a(json_result); }};

  m["strings"] = {[](size_t n, Rng& r) {
                    text.clear();
                    text.reserve(n * 90);
                    char buf[256];
                    for (size_t i = 0; i < n; i++) {
                      const char* level = LEVELS[r.uint(4)];
                      uint32_t user = r.uint(1000);
                      const char* res = RESOURCES[r.uint(5)];
                      uint32_t id = r.uint(10000);
                      int status = STATUSES[r.uint(6)];
                      uint32_t latency = r.uint(2000);
                      std::snprintf(buf, sizeof buf, "%sts=%zu level=%s user=u%u path=/api/%s/%u status=%d latency=%ums", i ? "\n" : "", 1700000000 + i, level, user, res, id, status, latency);
                      text += buf;
                    }
                    return fnv1a(text);
                  },
                  none,
                  [](Out&) {
                    const std::regex pattern(R"(status=(\d{3}) latency=(\d+)ms)");
                    uint64_t lines = 0, s5xx = 0, errors = 0, latency = 0, tokens = 0;
                    std::string_view all(text);
                    size_t start = 0;
                    while (true) {
                      size_t nl = all.find('\n', start);
                      std::string_view line = all.substr(start, nl == std::string_view::npos ? std::string_view::npos : nl - start);
                      lines++;
                      std::match_results<std::string_view::const_iterator> m;
                      if (std::regex_search(line.begin(), line.end(), m, pattern)) {
                        if (std::stoi(m[1].str()) >= 500) s5xx++;
                        latency += static_cast<uint64_t>(std::stoll(m[2].str()));
                      }
                      if (line.find("level=ERROR") != std::string_view::npos) errors++;
                      tokens += static_cast<uint64_t>(std::count(line.begin(), line.end(), ' ')) + 1;
                      if (nl == std::string_view::npos) break;
                      start = nl + 1;
                    }
                    counters = {lines, s5xx, errors, latency & 0xffffffffu, tokens};
                  },
                  [](Out& o) { o.check = fold_all(counters); }};

  m["sieve"] = {[](size_t n, Rng&) {
                  sieve_n = n;
                  return static_cast<uint32_t>(n);
                },
                none,
                [](Out&) {
                  size_t n = sieve_n;
                  std::vector<bool> composite(n + 1, false);
                  for (size_t i = 2; i * i <= n; i++)
                    if (!composite[i])
                      for (size_t j = i * i; j <= n; j += i) composite[j] = true;
                  uint64_t count = 0, sum = 0;
                  for (size_t i = 2; i <= n; i++)
                    if (!composite[i]) count++, sum += i;
                  counters = {count, sum & 0xffffffffu};
                },
                [](Out& o) { o.check = fold_all(counters); }};

  m["records"] = {[](size_t n, Rng& r) {
                    records.clear();
                    records.reserve(n);
                    uint32_t h = 0;
                    for (size_t i = 0; i < n; i++) {
                      uint32_t c = r.uint(20), age = 10 + r.uint(80), score = r.uint(1000), created = 1700000000u + r.uint(31536000);
                      records.push_back({static_cast<uint32_t>(i), "user_" + std::to_string(i), COUNTRIES[c], age, score, created});
                      h = fold(fold(fold(fold(h, c), age), score), created);
                    }
                    return h;
                  },
                  none,
                  [](Out&) {
                    constexpr uint32_t cutoff = 1700000000u + 15768000u;
                    std::unordered_map<std::string, Agg> groups;
                    for (const auto& r : records) {
                      if (r.age < 18 || r.score < 100 || r.created_at < cutoff) continue;
                      auto& g = groups[r.country];
                      g.country = r.country;
                      g.count++;
                      g.sum += r.score;
                      g.max = std::max<uint64_t>(g.max, r.score);
                      g.age_sum += r.age;
                    }
                    groups_sorted.clear();
                    for (auto& [_, g] : groups) groups_sorted.push_back(g);
                    std::sort(groups_sorted.begin(), groups_sorted.end(), [](const Agg& a, const Agg& b) { return a.sum != b.sum ? a.sum > b.sum : a.country < b.country; });
                  },
                  [](Out& o) {
                    uint32_t h = 0;
                    for (const auto& g : groups_sorted) {
                      h = fold(h, fnv1a(g.country));
                      h = fold(h, g.count);
                      h = fold(h, g.sum & 0xffffffffu);
                      h = fold(h, g.max);
                      h = fold(h, g.age_sum & 0xffffffffu);
                    }
                    o.check = h;
                  }};

  m["search"] = {[](size_t n, Rng& r) {
                   keys.resize(n);
                   queries.resize(n);
                   uint32_t h = 0;
                   for (auto& k : keys) h = fold(h, static_cast<uint32_t>(k = static_cast<int32_t>(r.next() & 0x7fffffff)));
                   for (size_t i = 0; i < n; i++) {
                     queries[i] = (i & 1) == 0 ? keys[r.uint(static_cast<uint32_t>(n))] : static_cast<int32_t>(r.next() & 0x7fffffff);
                     h = fold(h, static_cast<uint32_t>(queries[i]));
                   }
                   return h;
                 },
                 none,
                 [](Out& o) {
                   auto t = Clock::now();
                   auto lap = [&] {
                     auto now = Clock::now();
                     o.phases.push_back(elapsed(t, now));
                     t = now;
                   };
                   std::unordered_map<int32_t, uint32_t> index;
                   for (size_t i = 0; i < keys.size(); i++) index[keys[i]] = static_cast<uint32_t>(i);
                   lap();
                   uint64_t hits = 0, sum = 0;
                   for (auto q : queries)
                     if (auto it = index.find(q); it != index.end()) hits++, sum += it->second;
                   lap();
                   std::vector<int32_t> sorted = keys;
                   std::sort(sorted.begin(), sorted.end());
                   lap();
                   uint64_t bin_hits = 0;
                   for (auto q : queries) bin_hits += std::binary_search(sorted.begin(), sorted.end(), q) ? 1 : 0;
                   lap();
                   counters = {hits, sum & 0xffffffffu, bin_hits};
                 },
                 [](Out& o) { o.check = fold_all(counters); }};
  m["csv"] = {[](size_t n, Rng& r) {
                text.clear();
                text.reserve(n * 48 + 64);
                text += "order_id,date,region,sku,qty,unit_price_cents,discount_pct";
                char buf[128];
                for (size_t i = 0; i < n; i++) {
                  uint32_t month = 1 + r.uint(12), day = 1 + r.uint(28);
                  const char* region = REGIONS[r.uint(8)];
                  uint32_t sku = r.uint(1000), qty = 1 + r.uint(20), price = 99 + r.uint(99901), discount = 5 * r.uint(5);
                  std::snprintf(buf, sizeof buf, "\n%zu,2026-%02u-%02u,%s,SKU-%u,%u,%u,%u", i, month, day, region, sku, qty, price, discount);
                  text += buf;
                }
                return fnv1a(text);
              },
              none,
              [](Out&) {
                auto to_int = [](std::string_view s) {
                  uint64_t v = 0;
                  std::from_chars(s.data(), s.data() + s.size(), v);
                  return v;
                };
                std::map<std::pair<std::string_view, int>, CsvGroup> groups;
                std::string_view all(text);
                for (size_t start = all.find('\n'); start != std::string_view::npos;) {
                  start++;
                  size_t nl = all.find('\n', start);
                  std::string_view line = all.substr(start, nl == std::string_view::npos ? std::string_view::npos : nl - start);
                  std::array<std::string_view, 7> f;
                  size_t pos = 0;
                  for (auto& field : f) {
                    size_t comma = line.find(',', pos);
                    field = line.substr(pos, comma == std::string_view::npos ? std::string_view::npos : comma - pos);
                    pos = comma + 1;
                  }
                  int month = static_cast<int>(to_int(f[1].substr(5, 2)));
                  uint64_t qty = to_int(f[4]);
                  uint64_t revenue = qty * to_int(f[5]) * (100 - to_int(f[6])) / 100;
                  auto& g = groups[{f[2], month}];
                  g.orders++;
                  g.units += qty;
                  g.revenue += revenue;
                  start = nl;
                }
                csv_report = "region,month,orders,units,revenue_cents";
                char buf[128];
                for (const auto& [key, g] : groups) {
                  std::snprintf(buf, sizeof buf, "\n%.*s,2026-%02d,%llu,%llu,%llu", static_cast<int>(key.first.size()), key.first.data(), key.second,
                                static_cast<unsigned long long>(g.orders), static_cast<unsigned long long>(g.units), static_cast<unsigned long long>(g.revenue));
                  csv_report += buf;
                }
              },
              [](Out& o) { o.check = fnv1a(csv_report); }};

  m["metrics"] = {[](size_t n, Rng& r) {
                    values.resize(n);
                    uint32_t h = 0;
                    for (auto& v : values) {
                      uint32_t x = 20 + r.uint(80);
                      if (r.uint(100) < 3) x += 200 + r.uint(800);
                      v = static_cast<int32_t>(x);
                      h = fold(h, x);
                    }
                    return h;
                  },
                  none,
                  [](Out&) {
                    size_t n = values.size();
                    uint64_t window = 0, slow = 0, peak = 0, total = 0;
                    for (size_t i = 0; i < n; i++) {
                      window += static_cast<uint64_t>(values[i]);
                      total += static_cast<uint64_t>(values[i]);
                      if (i >= 60) window -= static_cast<uint64_t>(values[i - 60]);
                      if (i >= 59) {
                        if (window > 7200) slow++;
                        peak = std::max(peak, window);
                      }
                    }
                    uint32_t buckets = 0;
                    for (size_t start = 0; start < n; start += 60) buckets = fold(buckets, static_cast<uint64_t>(*std::max_element(values.begin() + start, values.begin() + std::min(start + 60, n))));
                    std::vector<int32_t> sorted = values;
                    std::sort(sorted.begin(), sorted.end());
                    auto rank = [&](size_t p) { return static_cast<uint64_t>(sorted[(p * n + 99) / 100 - 1]); };
                    counters = {slow, peak, buckets, rank(50), rank(95), rank(99), static_cast<uint64_t>(sorted[n - 1]), (total * 1000 / n) & 0xffffffffu};
                  },
                  [](Out& o) { o.check = fold_all(counters); }};

  m["infer"] = {[](size_t n, Rng& r) {
                  uint32_t h = 0;
                  auto draw = [&](size_t count, uint32_t k, int32_t offset) {
                    std::vector<int32_t> out(count);
                    for (auto& v : out) {
                      uint32_t raw = r.uint(k);
                      h = fold(h, raw);
                      v = static_cast<int32_t>(raw) - offset;
                    }
                    return out;
                  };
                  mlp.n = n;
                  mlp.w1 = draw(NN_H * NN_IN, 255, 127), mlp.b1 = draw(NN_H, 2001, 1000);
                  mlp.w2 = draw(NN_H * NN_H, 255, 127), mlp.b2 = draw(NN_H, 2001, 1000);
                  mlp.w3 = draw(NN_OUT * NN_H, 255, 127), mlp.b3 = draw(NN_OUT, 2001, 1000);
                  mlp.x = draw(n * NN_IN, 256, 128);
                  return h;
                },
                none,
                [](Out&) {
                  auto dense = [](const std::vector<int32_t>& w, const std::vector<int32_t>& b, const int32_t* in, size_t in_len, int32_t* out, size_t out_len) {
                    for (size_t j = 0; j < out_len; j++) out[j] = std::inner_product(in, in + in_len, w.begin() + j * in_len, b[j]);
                  };
                  std::array<int32_t, NN_H> h1, h2;
                  std::array<int32_t, NN_OUT> logits;
                  uint32_t preds = 0, conf = 0;
                  for (size_t s = 0; s < mlp.n; s++) {
                    dense(mlp.w1, mlp.b1, mlp.x.data() + s * NN_IN, NN_IN, h1.data(), NN_H);
                    for (auto& v : h1) v = std::min(127, std::max(0, v) / 1024);
                    dense(mlp.w2, mlp.b2, h1.data(), NN_H, h2.data(), NN_H);
                    for (auto& v : h2) v = std::min(127, std::max(0, v) / 1024);
                    dense(mlp.w3, mlp.b3, h2.data(), NN_H, logits.data(), NN_OUT);
                    size_t pred = static_cast<size_t>(std::max_element(logits.begin(), logits.end()) - logits.begin());
                    preds = fold(preds, pred);
                    conf += static_cast<uint32_t>(logits[pred] + 4194304);
                  }
                  counters = {preds, conf};
                },
                [](Out& o) { o.check = fold_all(counters); }};

  m["embed"] = {[](size_t n, Rng& r) {
                  emb_n = n;
                  uint32_t h = 0;
                  auto draw = [&](std::vector<int32_t>& out, size_t count) {
                    out.resize(count);
                    for (auto& v : out) {
                      uint32_t raw = r.uint(256);
                      h = fold(h, raw);
                      v = static_cast<int32_t>(raw) - 128;
                    }
                  };
                  draw(docs, n * EMB_D);
                  draw(emb_queries, EMB_Q * EMB_D);
                  return h;
                },
                none,
                [](Out&) {
                  counters.clear();
                  std::vector<std::pair<int32_t, uint32_t>> ranked(emb_n);
                  for (size_t q = 0; q < EMB_Q; q++) {
                    const int32_t* query = emb_queries.data() + q * EMB_D;
                    for (size_t d = 0; d < emb_n; d++) ranked[d] = {std::inner_product(query, query + EMB_D, docs.begin() + d * EMB_D, 0), static_cast<uint32_t>(d)};
                    std::sort(ranked.begin(), ranked.end(), [](const auto& a, const auto& b) { return a.first != b.first ? a.first > b.first : a.second < b.second; });
                    for (size_t k = 0; k < EMB_K; k++) counters.insert(counters.end(), {ranked[k].second, static_cast<uint64_t>(ranked[k].first + 2097152)});
                  }
                },
                [](Out& o) { o.check = fold_all(counters); }};

  m["pixel"] = {[](size_t n, Rng& r) {
                  img_n = n;
                  rgb.assign(n * n * 3, 0);
                  uint32_t h = 0;
                  for (size_t y = 0; y < n; y++)
                    for (size_t x = 0; x < n; x++) {
                      size_t p = (y * n + x) * 3;
                      rgb[p] = static_cast<uint8_t>((x + y + r.uint(64)) % 256);
                      rgb[p + 1] = static_cast<uint8_t>((2 * x + r.uint(64)) % 256);
                      rgb[p + 2] = static_cast<uint8_t>((2 * y + r.uint(64)) % 256);
                      h = fold(fold(fold(h, rgb[p]), rgb[p + 1]), rgb[p + 2]);
                    }
                  return h;
                },
                none,
                [](Out& o) {
                  auto t = Clock::now();
                  auto lap = [&] {
                    auto now = Clock::now();
                    o.phases.push_back(elapsed(t, now));
                    t = now;
                  };
                  const size_t n = img_n;
                  auto cl = [n](long v) { return static_cast<size_t>(std::clamp(v, 0L, static_cast<long>(n) - 1)); };

                  std::vector<uint8_t> gray(n * n);
                  for (size_t i = 0; i < n * n; i++) gray[i] = static_cast<uint8_t>((77 * rgb[i * 3] + 150 * rgb[i * 3 + 1] + 29 * rgb[i * 3 + 2]) / 256);
                  lap();

                  std::vector<uint8_t> blur(n * n);
                  for (size_t y = 0; y < n; y++) {
                    size_t ru = cl(static_cast<long>(y) - 1) * n, r0 = y * n, rd = cl(static_cast<long>(y) + 1) * n;
                    for (size_t x = 0; x < n; x++) {
                      size_t xl = cl(static_cast<long>(x) - 1), xr = cl(static_cast<long>(x) + 1);
                      int s = gray[ru + xl] + 2 * gray[ru + x] + gray[ru + xr] + 2 * gray[r0 + xl] + 4 * gray[r0 + x] + 2 * gray[r0 + xr] + gray[rd + xl] + 2 * gray[rd + x] + gray[rd + xr];
                      blur[r0 + x] = static_cast<uint8_t>(s / 16);
                    }
                  }
                  lap();

                  std::vector<uint8_t> mag(n * n);
                  for (size_t y = 0; y < n; y++) {
                    size_t ru = cl(static_cast<long>(y) - 1) * n, r0 = y * n, rd = cl(static_cast<long>(y) + 1) * n;
                    for (size_t x = 0; x < n; x++) {
                      size_t xl = cl(static_cast<long>(x) - 1), xr = cl(static_cast<long>(x) + 1);
                      int gx = blur[ru + xr] + 2 * blur[r0 + xr] + blur[rd + xr] - (blur[ru + xl] + 2 * blur[r0 + xl] + blur[rd + xl]);
                      int gy = blur[rd + xl] + 2 * blur[rd + x] + blur[rd + xr] - (blur[ru + xl] + 2 * blur[ru + x] + blur[ru + xr]);
                      mag[r0 + x] = static_cast<uint8_t>(std::min(255, std::abs(gx) + std::abs(gy)));
                    }
                  }
                  lap();

                  std::vector<uint64_t> hist(256);
                  uint64_t edges = 0;
                  for (auto v : mag) {
                    hist[v]++;
                    if (v >= 128) edges++;
                  }
                  lap();
                  hist.push_back(edges);
                  counters = std::move(hist);
                },
                [](Out& o) { o.check = fold_all(counters); }};

  return m;
}

}

static size_t ops_for(const std::string& name, size_t size) {
  if (name == "search") return size * 2;
  if (name == "embed") return size * EMB_Q;
  if (name == "pixel") return size * size;
  return size;
}

int main(int argc, char** argv) {
  std::setvbuf(stdout, nullptr, _IOLBF, 0);
  std::printf("{\"e\":\"hello\",\"lang\":\"cpp\"}\n");
  try {
    if (argc < 6) throw std::runtime_error("usage: harness <challenge> <size> <seed> <warmup> <runs>");
    auto all = challenges();
    auto it = all.find(argv[1]);
    if (it == all.end()) throw std::runtime_error(std::string("unknown challenge: ") + argv[1]);
    auto& c = it->second;
    size_t size = std::stoull(argv[2]);
    Rng rng(std::stoull(argv[3]));
    int warmup = std::stoi(argv[4]), runs = std::stoi(argv[5]);

    auto g0 = Clock::now();
    uint32_t hash = c.gen(size, rng);
    std::printf("{\"e\":\"ready\",\"genNs\":%llu,\"input\":\"%08x\",\"ops\":%zu}\n", static_cast<unsigned long long>(elapsed(g0, Clock::now())), hash, ops_for(argv[1], size));
    for (int i = 0; i < warmup + runs; i++) {
      Out o;
      c.prepare();
      auto t0 = Clock::now();
      c.run(o);
      auto ns = elapsed(t0, Clock::now());
      c.check(o);
      bool warm = i < warmup;
      std::printf("{\"e\":\"%s\",\"i\":%d,\"ns\":%llu,\"check\":\"%08x\"", warm ? "warmup" : "run", warm ? i : i - warmup, static_cast<unsigned long long>(ns), o.check);
      if (!o.phases.empty()) {
        std::printf(",\"phases\":[");
        for (size_t p = 0; p < o.phases.size(); p++) std::printf("%s%llu", p ? "," : "", static_cast<unsigned long long>(o.phases[p]));
        std::printf("]");
      }
      std::printf("}\n");
    }
    std::printf("{\"e\":\"done\"}\n");
  } catch (const std::exception& e) {
    std::printf("{\"e\":\"error\",\"msg\":\"%s\"}\n", e.what());
    return 1;
  }
  return 0;
}
