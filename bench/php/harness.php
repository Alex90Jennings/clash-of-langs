<?php
declare(strict_types=1);

function emit(array $e): void
{
    echo json_encode($e), "\n";
    flush();
}

emit(['e' => 'hello', 'lang' => 'php']);

const M = 0xFFFFFFFF;
const COUNTRIES = ['US', 'GB', 'DE', 'FR', 'JP', 'BR', 'IN', 'CN', 'CA', 'AU', 'NO', 'SE', 'ZA', 'NG', 'MX', 'ES', 'IT', 'KR', 'NL', 'PL'];
const LEVELS = ['INFO', 'WARN', 'ERROR', 'DEBUG'];
const RESOURCES = ['users', 'orders', 'items', 'auth', 'search'];
const STATUSES = [200, 200, 200, 201, 404, 500];

final class Rng
{
    private int $s;

    public function __construct(int $seed)
    {
        $this->s = ($seed & M) ?: 0x9E3779B9;
    }

    public function next(): int
    {
        $x = $this->s;
        $x ^= ($x << 13) & M;
        $x ^= $x >> 17;
        $x ^= ($x << 5) & M;
        return $this->s = $x;
    }

    public function int(int $n): int
    {
        return $this->next() % $n;
    }
}

function fold(int $h, int $v): int
{
    return ($h * 31 + $v) & M;
}

function fnv1a(string $s): int
{
    $h = 0x811C9DC5;
    $len = strlen($s);
    for ($i = 0; $i < $len; $i++) {
        $h = (($h ^ ord($s[$i])) * 0x01000193) & M;
    }
    return $h;
}

function fold_all(array $values): int
{
    $h = 0;
    foreach ($values as $v) {
        $h = fold($h, $v);
    }
    return $h;
}

$identity = fn($x) => $x;

const REGIONS = ['NA', 'EMEA', 'APAC', 'LATAM', 'ANZ', 'MEA', 'NORDICS', 'DACH'];
const NN_IN = 64;
const NN_H = 64;
const NN_OUT = 10;
const EMB_D = 64;
const EMB_Q = 8;
const EMB_K = 10;

function dense(array $w, array $b, array $v): array
{
    $out = [];
    foreach ($w as $j => $row) {
        $a = $b[$j];
        foreach ($row as $k => $wk) {
            $a += $wk * $v[$k];
        }
        $out[] = $a;
    }
    return $out;
}

function relu_q(array $values): array
{
    $out = [];
    foreach ($values as $a) {
        $out[] = min(127, intdiv(max(0, $a), 1024));
    }
    return $out;
}

$challenges = [
    'sort' => [
        'gen' => function (int $n, Rng $r): array {
            $data = [];
            for ($i = 0; $i < $n; $i++) {
                $data[] = $r->next() & 0x7FFFFFFF;
            }
            return [$data, fold_all($data), $n];
        },
        'prepare' => function (array $data): array {
            $copy = $data;
            $copy[0] = $copy[0] ?? 0;
            return $copy;
        },
        'run' => function (array &$work): array {
            sort($work, SORT_NUMERIC);
            return $work;
        },
        'check' => fn(array $sorted) => fold_all($sorted),
    ],
    'json' => [
        'gen' => function (int $n, Rng $r): array {
            $parts = [];
            for ($i = 0; $i < $n; $i++) {
                $country = COUNTRIES[$r->int(20)];
                $age = 10 + $r->int(80);
                $score = $r->int(1000);
                $active = ($r->next() & 1) === 1 ? 'true' : 'false';
                $t1 = $r->int(10);
                $t2 = $r->int(10);
                $parts[] = "{\"id\":$i,\"name\":\"user_$i\",\"country\":\"$country\",\"age\":$age,\"score\":$score,\"active\":$active,\"tags\":[\"t$t1\",\"t$t2\"]}";
            }
            $text = '[' . implode(',', $parts) . ']';
            return [$text, fnv1a($text), $n];
        },
        'prepare' => $identity,
        'run' => function (string $text): string {
            $out = [];
            foreach (json_decode($text, true, 512, JSON_THROW_ON_ERROR) as $r) {
                if ($r['active'] && $r['score'] >= 500) {
                    $out[] = ['country' => $r['country'], 'id' => $r['id'], 'name' => strtoupper($r['name']), 'score2' => $r['score'] * 2, 'tagCount' => count($r['tags'])];
                }
            }
            return json_encode($out, JSON_THROW_ON_ERROR);
        },
        'check' => fn(string $json) => fnv1a($json),
    ],
    'strings' => [
        'gen' => function (int $n, Rng $r): array {
            $lines = [];
            for ($i = 0; $i < $n; $i++) {
                $level = LEVELS[$r->int(4)];
                $user = $r->int(1000);
                $res = RESOURCES[$r->int(5)];
                $id = $r->int(10000);
                $status = STATUSES[$r->int(6)];
                $latency = $r->int(2000);
                $lines[] = 'ts=' . (1700000000 + $i) . " level=$level user=u$user path=/api/$res/$id status=$status latency={$latency}ms";
            }
            $text = implode("\n", $lines);
            return [$text, fnv1a($text), $n];
        },
        'prepare' => $identity,
        'run' => function (string $text): array {
            $lines = $s5xx = $errors = $latency = $tokens = 0;
            foreach (explode("\n", $text) as $line) {
                $lines++;
                if (preg_match('/status=(\d{3}) latency=(\d+)ms/', $line, $m)) {
                    if ((int) $m[1] >= 500) {
                        $s5xx++;
                    }
                    $latency += (int) $m[2];
                }
                if (str_contains($line, 'level=ERROR')) {
                    $errors++;
                }
                $tokens += count(explode(' ', $line));
            }
            return [$lines, $s5xx, $errors, $latency & M, $tokens];
        },
        'check' => fn(array $r) => fold_all($r),
    ],
    'sieve' => [
        'gen' => fn(int $n, Rng $r) => [$n, $n & M, $n],
        'prepare' => $identity,
        'run' => function (int $n): array {
            $composite = str_repeat("\0", $n + 1);
            for ($i = 2; $i * $i <= $n; $i++) {
                if ($composite[$i] === "\0") {
                    for ($j = $i * $i; $j <= $n; $j += $i) {
                        $composite[$j] = "\1";
                    }
                }
            }
            $count = $sum = 0;
            for ($i = 2; $i <= $n; $i++) {
                if ($composite[$i] === "\0") {
                    $count++;
                    $sum += $i;
                }
            }
            return [$count, $sum & M];
        },
        'check' => fn(array $r) => fold_all($r),
    ],
    'records' => [
        'gen' => function (int $n, Rng $r): array {
            $records = [];
            $h = 0;
            for ($i = 0; $i < $n; $i++) {
                $c = $r->int(20);
                $age = 10 + $r->int(80);
                $score = $r->int(1000);
                $createdAt = 1700000000 + $r->int(31536000);
                $records[] = ['id' => $i, 'name' => "user_$i", 'country' => COUNTRIES[$c], 'age' => $age, 'score' => $score, 'createdAt' => $createdAt];
                $h = fold(fold(fold(fold($h, $c), $age), $score), $createdAt);
            }
            return [$records, $h, $n];
        },
        'prepare' => $identity,
        'run' => function (array $records): array {
            $cutoff = 1700000000 + 15768000;
            $groups = [];
            foreach ($records as $r) {
                if ($r['age'] >= 18 && $r['score'] >= 100 && $r['createdAt'] >= $cutoff) {
                    $g = &$groups[$r['country']];
                    $g ??= ['country' => $r['country'], 'count' => 0, 'sum' => 0, 'max' => 0, 'ageSum' => 0];
                    $g['count']++;
                    $g['sum'] += $r['score'];
                    if ($r['score'] > $g['max']) {
                        $g['max'] = $r['score'];
                    }
                    $g['ageSum'] += $r['age'];
                    unset($g);
                }
            }
            $sorted = array_values($groups);
            usort($sorted, fn($a, $b) => [$b['sum'], $a['country']] <=> [$a['sum'], $b['country']]);
            return $sorted;
        },
        'check' => function (array $groups): int {
            $h = 0;
            foreach ($groups as $g) {
                $h = fold($h, fnv1a($g['country']));
                $h = fold($h, $g['count']);
                $h = fold($h, $g['sum'] & M);
                $h = fold($h, $g['max']);
                $h = fold($h, $g['ageSum'] & M);
            }
            return $h;
        },
    ],
    'search' => [
        'gen' => function (int $n, Rng $r): array {
            $keys = [];
            $queries = [];
            for ($i = 0; $i < $n; $i++) {
                $keys[] = $r->next() & 0x7FFFFFFF;
            }
            for ($i = 0; $i < $n; $i++) {
                $queries[] = ($i & 1) === 0 ? $keys[$r->int($n)] : $r->next() & 0x7FFFFFFF;
            }
            return [[$keys, $queries], fold_all(array_merge($keys, $queries)), 2 * $n];
        },
        'prepare' => $identity,
        'run' => function (array $in): array {
            [$keys, $queries] = $in;
            $phases = [];
            $t = hrtime(true);
            $lap = function () use (&$t, &$phases): void {
                $now = hrtime(true);
                $phases[] = $now - $t;
                $t = $now;
            };
            $index = [];
            foreach ($keys as $i => $k) {
                $index[$k] = $i;
            }
            $lap();
            $hits = $sum = 0;
            foreach ($queries as $q) {
                if (isset($index[$q])) {
                    $hits++;
                    $sum += $index[$q];
                }
            }
            $lap();
            $sorted = $keys;
            sort($sorted, SORT_NUMERIC);
            $lap();
            $binHits = 0;
            $size = count($sorted);
            foreach ($queries as $q) {
                $lo = 0;
                $hi = $size;
                while ($lo < $hi) {
                    $mid = ($lo + $hi) >> 1;
                    if ($sorted[$mid] < $q) {
                        $lo = $mid + 1;
                    } else {
                        $hi = $mid;
                    }
                }
                if ($lo < $size && $sorted[$lo] === $q) {
                    $binHits++;
                }
            }
            $lap();
            return ['result' => [$hits, $sum & M, $binHits], 'phases' => $phases];
        },
        'check' => fn(array $r) => fold_all($r['result']),
    ],
    'csv' => [
        'gen' => function (int $n, Rng $r): array {
            $lines = ['order_id,date,region,sku,qty,unit_price_cents,discount_pct'];
            for ($i = 0; $i < $n; $i++) {
                $month = 1 + $r->int(12);
                $day = 1 + $r->int(28);
                $region = REGIONS[$r->int(8)];
                $sku = $r->int(1000);
                $qty = 1 + $r->int(20);
                $price = 99 + $r->int(99901);
                $discount = 5 * $r->int(5);
                $lines[] = sprintf('%d,2026-%02d-%02d,%s,SKU-%d,%d,%d,%d', $i, $month, $day, $region, $sku, $qty, $price, $discount);
            }
            $text = implode("\n", $lines);
            return [$text, fnv1a($text), $n];
        },
        'prepare' => $identity,
        'run' => function (string $text): string {
            $lines = explode("\n", $text);
            $count = count($lines);
            $groups = [];
            for ($i = 1; $i < $count; $i++) {
                $f = explode(',', $lines[$i]);
                $month = (int) substr($f[1], 5, 2);
                $qty = (int) $f[4];
                $g = &$groups[$f[2]][$month];
                $g ??= [0, 0, 0];
                $g[0]++;
                $g[1] += $qty;
                $g[2] += intdiv($qty * (int) $f[5] * (100 - (int) $f[6]), 100);
                unset($g);
            }
            ksort($groups, SORT_STRING);
            $out = ['region,month,orders,units,revenue_cents'];
            foreach ($groups as $region => $months) {
                ksort($months, SORT_NUMERIC);
                foreach ($months as $month => [$orders, $units, $revenue]) {
                    $out[] = sprintf('%s,2026-%02d,%d,%d,%d', $region, $month, $orders, $units, $revenue);
                }
            }
            return implode("\n", $out);
        },
        'check' => fn(string $report) => fnv1a($report),
    ],
    'metrics' => [
        'gen' => function (int $n, Rng $r): array {
            $values = [];
            for ($i = 0; $i < $n; $i++) {
                $v = 20 + $r->int(80);
                if ($r->int(100) < 3) {
                    $v += 200 + $r->int(800);
                }
                $values[] = $v;
            }
            return [$values, fold_all($values), $n];
        },
        'prepare' => $identity,
        'run' => function (array $values): array {
            $n = count($values);
            $window = $slow = $peak = 0;
            foreach ($values as $i => $v) {
                $window += $v;
                if ($i >= 60) {
                    $window -= $values[$i - 60];
                }
                if ($i >= 59) {
                    if ($window > 7200) {
                        $slow++;
                    }
                    if ($window > $peak) {
                        $peak = $window;
                    }
                }
            }
            $buckets = 0;
            foreach (array_chunk($values, 60) as $block) {
                $buckets = fold($buckets, max($block));
            }
            $sorted = $values;
            sort($sorted, SORT_NUMERIC);
            $rank = fn(int $p): int => $sorted[intdiv($p * $n + 99, 100) - 1];
            $meanMilli = intdiv(array_sum($values) * 1000, $n);
            return [$slow, $peak, $buckets, $rank(50), $rank(95), $rank(99), $sorted[$n - 1], $meanMilli & M];
        },
        'check' => fn(array $r) => fold_all($r),
    ],
    'infer' => [
        'gen' => function (int $n, Rng $r): array {
            $h = 0;
            $draw = function (int $count, int $k, int $offset) use ($r, &$h): array {
                $out = [];
                for ($i = 0; $i < $count; $i++) {
                    $raw = $r->int($k);
                    $h = fold($h, $raw);
                    $out[] = $raw - $offset;
                }
                return $out;
            };
            $matrix = function (int $rows, int $cols, int $k, int $offset) use ($draw): array {
                $out = [];
                for ($i = 0; $i < $rows; $i++) {
                    $out[] = $draw($cols, $k, $offset);
                }
                return $out;
            };
            $w1 = $matrix(NN_H, NN_IN, 255, 127);
            $b1 = $draw(NN_H, 2001, 1000);
            $w2 = $matrix(NN_H, NN_H, 255, 127);
            $b2 = $draw(NN_H, 2001, 1000);
            $w3 = $matrix(NN_OUT, NN_H, 255, 127);
            $b3 = $draw(NN_OUT, 2001, 1000);
            $x = $matrix($n, NN_IN, 256, 128);
            return [[$w1, $b1, $w2, $b2, $w3, $b3, $x], $h, $n];
        },
        'prepare' => $identity,
        'run' => function (array $model): array {
            [$w1, $b1, $w2, $b2, $w3, $b3, $x] = $model;
            $preds = $conf = 0;
            foreach ($x as $sample) {
                $h1 = relu_q(dense($w1, $b1, $sample));
                $h2 = relu_q(dense($w2, $b2, $h1));
                $logits = dense($w3, $b3, $h2);
                $pred = array_search(max($logits), $logits, true);
                $preds = fold($preds, $pred);
                $conf = ($conf + $logits[$pred] + 4194304) & M;
            }
            return [$preds, $conf];
        },
        'check' => fn(array $r) => fold_all($r),
    ],
    'embed' => [
        'gen' => function (int $n, Rng $r): array {
            $h = 0;
            $vectors = function (int $count) use ($r, &$h): array {
                $out = [];
                for ($i = 0; $i < $count; $i++) {
                    $vec = [];
                    for ($k = 0; $k < EMB_D; $k++) {
                        $raw = $r->int(256);
                        $h = fold($h, $raw);
                        $vec[] = $raw - 128;
                    }
                    $out[] = $vec;
                }
                return $out;
            };
            $docs = $vectors($n);
            $queries = $vectors(EMB_Q);
            return [[$docs, $queries], $h, $n * EMB_Q];
        },
        'prepare' => $identity,
        'run' => function (array $in): array {
            [$docs, $queries] = $in;
            $results = [];
            foreach ($queries as $query) {
                $scores = [];
                foreach ($docs as $doc) {
                    $s = 0;
                    foreach ($doc as $k => $v) {
                        $s += $v * $query[$k];
                    }
                    $scores[] = $s;
                }
                arsort($scores, SORT_NUMERIC);
                foreach (array_slice($scores, 0, EMB_K, true) as $d => $score) {
                    array_push($results, $d, $score + 2097152);
                }
            }
            return $results;
        },
        'check' => fn(array $r) => fold_all($r),
    ],
    'pixel' => [
        'gen' => function (int $n, Rng $r): array {
            $rgb = [];
            $h = 0;
            for ($y = 0; $y < $n; $y++) {
                for ($x = 0; $x < $n; $x++) {
                    $cr = ($x + $y + $r->int(64)) % 256;
                    $cg = (2 * $x + $r->int(64)) % 256;
                    $cb = (2 * $y + $r->int(64)) % 256;
                    array_push($rgb, $cr, $cg, $cb);
                    $h = fold(fold(fold($h, $cr), $cg), $cb);
                }
            }
            return [[$rgb, $n], $h, $n * $n];
        },
        'prepare' => $identity,
        'run' => function (array $in): array {
            [$rgb, $n] = $in;
            $phases = [];
            $t = hrtime(true);
            $lap = function () use (&$t, &$phases): void {
                $now = hrtime(true);
                $phases[] = $now - $t;
                $t = $now;
            };
            $last = $n - 1;
            $size = $n * $n;

            $gray = [];
            for ($i = 0; $i < $size; $i++) {
                $gray[] = (77 * $rgb[$i * 3] + 150 * $rgb[$i * 3 + 1] + 29 * $rgb[$i * 3 + 2]) >> 8;
            }
            $lap();

            $blur = [];
            for ($y = 0; $y < $n; $y++) {
                $ru = max($y - 1, 0) * $n;
                $r0 = $y * $n;
                $rd = min($y + 1, $last) * $n;
                for ($x = 0; $x < $n; $x++) {
                    $xl = max($x - 1, 0);
                    $xr = min($x + 1, $last);
                    $s = $gray[$ru + $xl] + 2 * $gray[$ru + $x] + $gray[$ru + $xr]
                        + 2 * $gray[$r0 + $xl] + 4 * $gray[$r0 + $x] + 2 * $gray[$r0 + $xr]
                        + $gray[$rd + $xl] + 2 * $gray[$rd + $x] + $gray[$rd + $xr];
                    $blur[] = $s >> 4;
                }
            }
            $lap();

            $mag = [];
            for ($y = 0; $y < $n; $y++) {
                $ru = max($y - 1, 0) * $n;
                $r0 = $y * $n;
                $rd = min($y + 1, $last) * $n;
                for ($x = 0; $x < $n; $x++) {
                    $xl = max($x - 1, 0);
                    $xr = min($x + 1, $last);
                    $gx = $blur[$ru + $xr] + 2 * $blur[$r0 + $xr] + $blur[$rd + $xr] - ($blur[$ru + $xl] + 2 * $blur[$r0 + $xl] + $blur[$rd + $xl]);
                    $gy = $blur[$rd + $xl] + 2 * $blur[$rd + $x] + $blur[$rd + $xr] - ($blur[$ru + $xl] + 2 * $blur[$ru + $x] + $blur[$ru + $xr]);
                    $mag[] = min(255, abs($gx) + abs($gy));
                }
            }
            $lap();

            $hist = array_fill(0, 256, 0);
            $edges = 0;
            foreach ($mag as $m) {
                $hist[$m]++;
                if ($m >= 128) {
                    $edges++;
                }
            }
            $lap();

            $hist[] = $edges;
            return ['result' => $hist, 'phases' => $phases];
        },
        'check' => fn(array $r) => fold_all($r['result']),
    ],
];

try {
    [, $name, $size, $seed, $warmup, $runs] = $argv + [null, '', '0', '0', '0', '0'];
    $c = $challenges[$name] ?? throw new RuntimeException("unknown challenge: $name");
    [$size, $seed, $warmup, $runs] = [(int) $size, (int) $seed, (int) $warmup, (int) $runs];
    $g0 = hrtime(true);
    [$input, $hash, $ops] = $c['gen']($size, new Rng($seed));
    emit(['e' => 'ready', 'genNs' => hrtime(true) - $g0, 'input' => sprintf('%08x', $hash), 'ops' => $ops]);
    for ($i = 0; $i < $warmup + $runs; $i++) {
        $work = $c['prepare']($input);
        $t0 = hrtime(true);
        $out = $c['run']($work);
        $ns = hrtime(true) - $t0;
        $warm = $i < $warmup;
        $event = ['e' => $warm ? 'warmup' : 'run', 'i' => $warm ? $i : $i - $warmup, 'ns' => $ns, 'check' => sprintf('%08x', $c['check']($out))];
        if (is_array($out) && isset($out['phases'])) {
            $event['phases'] = $out['phases'];
        }
        emit($event);
    }
    emit(['e' => 'done']);
} catch (Throwable $e) {
    emit(['e' => 'error', 'msg' => $e->getMessage()]);
    exit(1);
}
