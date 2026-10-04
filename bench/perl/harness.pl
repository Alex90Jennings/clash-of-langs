#!/usr/bin/env perl
use strict;
use warnings;
use JSON::PP ();
use Time::HiRes qw(clock_gettime CLOCK_MONOTONIC);
use List::Util qw(max sum0);

$| = 1;
my $JSON = JSON::PP->new->canonical(1);

sub emit { print $JSON->encode($_[0]), "\n" }
sub now_ns { int(clock_gettime(CLOCK_MONOTONIC) * 1e9) }

emit({ e => "hello", lang => "perl" });

use constant M => 0xFFFFFFFF;
my @COUNTRIES = qw(US GB DE FR JP BR IN CN CA AU NO SE ZA NG MX ES IT KR NL PL);
my @LEVELS    = qw(INFO WARN ERROR DEBUG);
my @RESOURCES = qw(users orders items auth search);
my @STATUSES  = (200, 200, 200, 201, 404, 500);
my @REGIONS   = qw(NA EMEA APAC LATAM ANZ MEA NORDICS DACH);
use constant { NN_IN => 64, NN_H => 64, NN_OUT => 10, EMB_D => 64, EMB_Q => 8, EMB_K => 10 };

my $rng_state;
sub rng_next {
    my $x = $rng_state;
    $x ^= ($x << 13) & M;
    $x ^= $x >> 17;
    $x ^= ($x << 5) & M;
    return $rng_state = $x;
}
sub rng_int { rng_next() % $_[0] }

sub fold { (($_[0] * 31) + $_[1]) & M }
sub fnv1a {
    my $h = 0x811C9DC5;
    for my $b (unpack "C*", $_[0]) { $h = (($h ^ $b) * 0x01000193) & M }
    return $h;
}
sub fold_all { my $h = 0; $h = fold($h, $_) for @{ $_[0] }; $h }

my %CHALLENGES = (
    sort => {
        gen => sub {
            my ($n) = @_;
            my @data = map { rng_next() & 0x7FFFFFFF } 1 .. $n;
            return (\@data, fold_all(\@data), $n);
        },
        prepare => sub { [ @{ $_[0] } ] },
        run     => sub { [ sort { $a <=> $b } @{ $_[0] } ] },
        check   => sub { fold_all($_[0]) },
    },
    json => {
        gen => sub {
            my ($n) = @_;
            my @parts;
            for my $i (0 .. $n - 1) {
                my $country = $COUNTRIES[ rng_int(20) ];
                my $age     = 10 + rng_int(80);
                my $score   = rng_int(1000);
                my $active  = (rng_next() & 1) == 1 ? "true" : "false";
                my ($t1, $t2) = (rng_int(10), rng_int(10));
                push @parts, qq({"id":$i,"name":"user_$i","country":"$country","age":$age,"score":$score,"active":$active,"tags":["t$t1","t$t2"]});
            }
            my $text = "[" . join(",", @parts) . "]";
            return ($text, fnv1a($text), $n);
        },
        prepare => sub { $_[0] },
        run     => sub {
            my $records = $JSON->decode($_[0]);
            my @out = map {
                +{ country => $_->{country}, id => $_->{id}, name => uc $_->{name}, score2 => $_->{score} * 2, tagCount => scalar @{ $_->{tags} } }
            } grep { $_->{active} && $_->{score} >= 500 } @$records;
            return $JSON->encode(\@out);
        },
        check => sub { fnv1a($_[0]) },
    },
    strings => {
        gen => sub {
            my ($n) = @_;
            my @lines;
            for my $i (0 .. $n - 1) {
                my $level   = $LEVELS[ rng_int(4) ];
                my $user    = rng_int(1000);
                my $res     = $RESOURCES[ rng_int(5) ];
                my $id      = rng_int(10000);
                my $status  = $STATUSES[ rng_int(6) ];
                my $latency = rng_int(2000);
                push @lines, "ts=" . (1700000000 + $i) . " level=$level user=u$user path=/api/$res/$id status=$status latency=${latency}ms";
            }
            my $text = join "\n", @lines;
            return ($text, fnv1a($text), $n);
        },
        prepare => sub { $_[0] },
        run     => sub {
            my ($lines, $s5xx, $errors, $latency, $tokens) = (0, 0, 0, 0, 0);
            for my $line (split /\n/, $_[0], -1) {
                $lines++;
                if ($line =~ /status=(\d{3}) latency=(\d+)ms/) {
                    $s5xx++ if $1 >= 500;
                    $latency += $2;
                }
                $errors++ if index($line, "level=ERROR") >= 0;
                $tokens += scalar(my @f = split / /, $line, -1);
            }
            return [ $lines, $s5xx, $errors, $latency & M, $tokens ];
        },
        check => sub { fold_all($_[0]) },
    },
    sieve => {
        gen     => sub { ($_[0], $_[0] & M, $_[0]) },
        prepare => sub { $_[0] },
        run     => sub {
            my ($n) = @_;
            my $composite = "\0" x ($n + 1);
            for (my $i = 2; $i * $i <= $n; $i++) {
                next if vec($composite, $i, 8);
                for (my $j = $i * $i; $j <= $n; $j += $i) { vec($composite, $j, 8) = 1 }
            }
            my ($count, $sum) = (0, 0);
            for my $i (2 .. $n) {
                next if vec($composite, $i, 8);
                $count++;
                $sum += $i;
            }
            return [ $count, $sum & M ];
        },
        check => sub { fold_all($_[0]) },
    },
    records => {
        gen => sub {
            my ($n) = @_;
            my ($h, @records) = (0);
            for my $i (0 .. $n - 1) {
                my $c          = rng_int(20);
                my $age        = 10 + rng_int(80);
                my $score      = rng_int(1000);
                my $created_at = 1700000000 + rng_int(31536000);
                push @records, { id => $i, name => "user_$i", country => $COUNTRIES[$c], age => $age, score => $score, created_at => $created_at };
                $h = fold(fold(fold(fold($h, $c), $age), $score), $created_at);
            }
            return (\@records, $h, $n);
        },
        prepare => sub { $_[0] },
        run     => sub {
            my $cutoff = 1700000000 + 15768000;
            my %groups;
            for my $r (@{ $_[0] }) {
                next unless $r->{age} >= 18 && $r->{score} >= 100 && $r->{created_at} >= $cutoff;
                my $g = $groups{ $r->{country} } //= { country => $r->{country}, count => 0, sum => 0, max => 0, age_sum => 0 };
                $g->{count}++;
                $g->{sum} += $r->{score};
                $g->{max} = $r->{score} if $r->{score} > $g->{max};
                $g->{age_sum} += $r->{age};
            }
            return [ sort { $b->{sum} <=> $a->{sum} || $a->{country} cmp $b->{country} } values %groups ];
        },
        check => sub {
            my $h = 0;
            for my $g (@{ $_[0] }) {
                $h = fold($h, fnv1a($g->{country}));
                $h = fold($h, $g->{count});
                $h = fold($h, $g->{sum} & M);
                $h = fold($h, $g->{max});
                $h = fold($h, $g->{age_sum} & M);
            }
            return $h;
        },
    },
    search => {
        gen => sub {
            my ($n) = @_;
            my @keys = map { rng_next() & 0x7FFFFFFF } 1 .. $n;
            my @queries;
            for my $i (0 .. $n - 1) { push @queries, ($i & 1) == 0 ? $keys[ rng_int($n) ] : rng_next() & 0x7FFFFFFF }
            return ([ \@keys, \@queries ], fold_all([ @keys, @queries ]), 2 * $n);
        },
        prepare => sub { $_[0] },
        run     => sub {
            my ($keys, $queries) = @{ $_[0] };
            my @phases;
            my $t   = now_ns();
            my $lap = sub { my $now = now_ns(); push @phases, $now - $t; $t = $now };
            my %index;
            $index{ $keys->[$_] } = $_ for 0 .. $#$keys;
            $lap->();
            my ($hits, $sum) = (0, 0);
            for my $q (@$queries) {
                my $v = $index{$q};
                next unless defined $v;
                $hits++;
                $sum += $v;
            }
            $lap->();
            my @sorted = sort { $a <=> $b } @$keys;
            $lap->();
            my $bin_hits = 0;
            for my $q (@$queries) {
                my ($lo, $hi) = (0, scalar @sorted);
                while ($lo < $hi) {
                    my $mid = ($lo + $hi) >> 1;
                    if ($sorted[$mid] < $q) { $lo = $mid + 1 } else { $hi = $mid }
                }
                $bin_hits++ if $lo < @sorted && $sorted[$lo] == $q;
            }
            $lap->();
            return { result => [ $hits, $sum & M, $bin_hits ], phases => \@phases };
        },
        check => sub { fold_all($_[0]{result}) },
    },
    csv => {
        gen => sub {
            my ($n) = @_;
            my @lines = ("order_id,date,region,sku,qty,unit_price_cents,discount_pct");
            for my $i (0 .. $n - 1) {
                my $month    = 1 + rng_int(12);
                my $day      = 1 + rng_int(28);
                my $region   = $REGIONS[ rng_int(8) ];
                my $sku      = rng_int(1000);
                my $qty      = 1 + rng_int(20);
                my $price    = 99 + rng_int(99901);
                my $discount = 5 * rng_int(5);
                push @lines, sprintf("%d,2026-%02d-%02d,%s,SKU-%d,%d,%d,%d", $i, $month, $day, $region, $sku, $qty, $price, $discount);
            }
            my $text = join "\n", @lines;
            return ($text, fnv1a($text), $n);
        },
        prepare => sub { $_[0] },
        run     => sub {
            my @lines = split /\n/, $_[0];
            shift @lines;
            my %groups;
            for my $line (@lines) {
                my @f       = split /,/, $line;
                my $month   = substr($f[1], 5, 2) + 0;
                my $revenue = int($f[4] * $f[5] * (100 - $f[6]) / 100);
                my $g       = $groups{ $f[2] }{$month} //= { orders => 0, units => 0, revenue => 0 };
                $g->{orders}++;
                $g->{units}   += $f[4];
                $g->{revenue} += $revenue;
            }
            my @out = ("region,month,orders,units,revenue_cents");
            for my $region (sort keys %groups) {
                for my $month (sort { $a <=> $b } keys %{ $groups{$region} }) {
                    my $g = $groups{$region}{$month};
                    push @out, sprintf("%s,2026-%02d,%d,%d,%d", $region, $month, $g->{orders}, $g->{units}, $g->{revenue});
                }
            }
            return join "\n", @out;
        },
        check => sub { fnv1a($_[0]) },
    },
    metrics => {
        gen => sub {
            my ($n) = @_;
            my @values;
            for (1 .. $n) {
                my $v = 20 + rng_int(80);
                $v += 200 + rng_int(800) if rng_int(100) < 3;
                push @values, $v;
            }
            return (\@values, fold_all(\@values), $n);
        },
        prepare => sub { $_[0] },
        run     => sub {
            my ($values) = @_;
            my $n = @$values;
            my ($window, $slow, $peak, $total) = (0, 0, 0, 0);
            for my $i (0 .. $n - 1) {
                $window += $values->[$i];
                $total  += $values->[$i];
                $window -= $values->[ $i - 60 ] if $i >= 60;
                if ($i >= 59) {
                    $slow++ if $window > 7200;
                    $peak = $window if $window > $peak;
                }
            }
            my $buckets = 0;
            for (my $start = 0; $start < $n; $start += 60) {
                my $end = $start + 59 < $n - 1 ? $start + 59 : $n - 1;
                $buckets = fold($buckets, max(@$values[ $start .. $end ]));
            }
            my @sorted = sort { $a <=> $b } @$values;
            my $rank = sub { $sorted[ int(($_[0] * $n + 99) / 100) - 1 ] };
            my $mean_milli = int($total * 1000 / $n);
            return [ $slow, $peak, $buckets, $rank->(50), $rank->(95), $rank->(99), $sorted[-1], $mean_milli & M ];
        },
        check => sub { fold_all($_[0]) },
    },
    infer => {
        gen => sub {
            my ($n) = @_;
            my $h    = 0;
            my $draw = sub {
                my ($count, $k, $offset) = @_;
                return [ map { my $raw = rng_int($k); $h = fold($h, $raw); $raw - $offset } 1 .. $count ];
            };
            my $rows = sub {
                my ($count, $width, $k, $offset) = @_;
                return [ map { $draw->($width, $k, $offset) } 1 .. $count ];
            };
            my $w1 = $rows->(NN_H, NN_IN, 255, 127);
            my $b1 = $draw->(NN_H, 2001, 1000);
            my $w2 = $rows->(NN_H, NN_H, 255, 127);
            my $b2 = $draw->(NN_H, 2001, 1000);
            my $w3 = $rows->(NN_OUT, NN_H, 255, 127);
            my $b3 = $draw->(NN_OUT, 2001, 1000);
            my $x  = $rows->($n, NN_IN, 256, 128);
            return ({ w1 => $w1, b1 => $b1, w2 => $w2, b2 => $b2, w3 => $w3, b3 => $b3, x => $x }, $h, $n);
        },
        prepare => sub { $_[0] },
        run     => sub {
            my ($m) = @_;
            my $dense = sub {
                my ($w, $b, $input) = @_;
                my @out;
                for my $j (0 .. $#$w) {
                    my $row = $w->[$j];
                    push @out, $b->[$j] + sum0(map { $row->[$_] * $input->[$_] } 0 .. $#$input);
                }
                return \@out;
            };
            my $relu = sub { [ map { my $v = $_ > 0 ? int($_ / 1024) : 0; $v > 127 ? 127 : $v } @{ $_[0] } ] };
            my ($preds, $conf) = (0, 0);
            for my $x (@{ $m->{x} }) {
                my $h1     = $relu->($dense->($m->{w1}, $m->{b1}, $x));
                my $h2     = $relu->($dense->($m->{w2}, $m->{b2}, $h1));
                my $logits = $dense->($m->{w3}, $m->{b3}, $h2);
                my $pred   = 0;
                for my $o (1 .. NN_OUT - 1) { $pred = $o if $logits->[$o] > $logits->[$pred] }
                $preds = fold($preds, $pred);
                $conf  = ($conf + $logits->[$pred] + 4194304) & M;
            }
            return [ $preds, $conf ];
        },
        check => sub { fold_all($_[0]) },
    },
    embed => {
        gen => sub {
            my ($n) = @_;
            my $h    = 0;
            my $draw = sub {
                my ($count) = @_;
                return [ map { [ map { my $raw = rng_int(256); $h = fold($h, $raw); $raw - 128 } 1 .. EMB_D ] } 1 .. $count ];
            };
            my $docs    = $draw->($n);
            my $queries = $draw->(EMB_Q);
            return ([ $docs, $queries ], $h, $n * EMB_Q);
        },
        prepare => sub { $_[0] },
        run     => sub {
            my ($docs, $queries) = @{ $_[0] };
            my @results;
            for my $q (@$queries) {
                my @scores = map { my $d = $_; sum0(map { $d->[$_] * $q->[$_] } 0 .. EMB_D - 1) } @$docs;
                my @order  = sort { $scores[$b] <=> $scores[$a] || $a <=> $b } 0 .. $#scores;
                push @results, $_, $scores[$_] + 2097152 for @order[ 0 .. EMB_K - 1 ];
            }
            return \@results;
        },
        check => sub { fold_all($_[0]) },
    },
    pixel => {
        gen => sub {
            my ($n) = @_;
            my ($h, @rgb) = (0);
            for my $y (0 .. $n - 1) {
                for my $x (0 .. $n - 1) {
                    my $r = ($x + $y + rng_int(64)) % 256;
                    my $g = (2 * $x + rng_int(64)) % 256;
                    my $b = (2 * $y + rng_int(64)) % 256;
                    push @rgb, $r, $g, $b;
                    $h = fold(fold(fold($h, $r), $g), $b);
                }
            }
            return ([ \@rgb, $n ], $h, $n * $n);
        },
        prepare => sub { $_[0] },
        run     => sub {
            my ($rgb, $n) = @{ $_[0] };
            my @phases;
            my $t   = now_ns();
            my $lap = sub { my $now = now_ns(); push @phases, $now - $t; $t = $now };
            my $last = $n - 1;
            my @gray = map { (77 * $rgb->[ $_ * 3 ] + 150 * $rgb->[ $_ * 3 + 1 ] + 29 * $rgb->[ $_ * 3 + 2 ]) >> 8 } 0 .. $n * $n - 1;
            $lap->();
            my @blur;
            for my $y (0 .. $last) {
                my ($ru, $r0, $rd) = (($y > 0 ? $y - 1 : 0) * $n, $y * $n, ($y < $last ? $y + 1 : $last) * $n);
                for my $x (0 .. $last) {
                    my ($xl, $xr) = ($x > 0 ? $x - 1 : 0, $x < $last ? $x + 1 : $last);
                    $blur[ $r0 + $x ] = ($gray[ $ru + $xl ] + 2 * $gray[ $ru + $x ] + $gray[ $ru + $xr ] + 2 * $gray[ $r0 + $xl ] + 4 * $gray[ $r0 + $x ] + 2 * $gray[ $r0 + $xr ] + $gray[ $rd + $xl ] + 2 * $gray[ $rd + $x ] + $gray[ $rd + $xr ]) >> 4;
                }
            }
            $lap->();
            my @mag;
            for my $y (0 .. $last) {
                my ($ru, $r0, $rd) = (($y > 0 ? $y - 1 : 0) * $n, $y * $n, ($y < $last ? $y + 1 : $last) * $n);
                for my $x (0 .. $last) {
                    my ($xl, $xr) = ($x > 0 ? $x - 1 : 0, $x < $last ? $x + 1 : $last);
                    my $gx = $blur[ $ru + $xr ] + 2 * $blur[ $r0 + $xr ] + $blur[ $rd + $xr ] - ($blur[ $ru + $xl ] + 2 * $blur[ $r0 + $xl ] + $blur[ $rd + $xl ]);
                    my $gy = $blur[ $rd + $xl ] + 2 * $blur[ $rd + $x ] + $blur[ $rd + $xr ] - ($blur[ $ru + $xl ] + 2 * $blur[ $ru + $x ] + $blur[ $ru + $xr ]);
                    my $m  = abs($gx) + abs($gy);
                    $mag[ $r0 + $x ] = $m > 255 ? 255 : $m;
                }
            }
            $lap->();
            my @hist  = (0) x 256;
            my $edges = 0;
            for my $m (@mag) {
                $hist[$m]++;
                $edges++ if $m >= 128;
            }
            $lap->();
            return { result => [ @hist, $edges ], phases => \@phases };
        },
        check => sub { fold_all($_[0]{result}) },
    },
);

eval {
    my ($name, $size, $seed, $warmup, $runs) = @ARGV;
    my $c = $CHALLENGES{$name} or die "unknown challenge: $name\n";
    $rng_state = ($seed & M) || 0x9E3779B9;
    my $g0 = now_ns();
    my ($input, $hash, $ops) = $c->{gen}->($size);
    emit({ e => "ready", genNs => now_ns() - $g0, input => sprintf("%08x", $hash), ops => $ops + 0 });
    for my $i (0 .. $warmup + $runs - 1) {
        my $work = $c->{prepare}->($input);
        my $t0   = now_ns();
        my $out  = $c->{run}->($work);
        my $ns   = now_ns() - $t0;
        my $warm = $i < $warmup;
        my %event = (e => $warm ? "warmup" : "run", i => $warm ? $i : $i - $warmup, ns => $ns, check => sprintf("%08x", $c->{check}->($out)));
        $event{phases} = $out->{phases} if ref $out eq "HASH" && $out->{phases};
        emit(\%event);
    }
    emit({ e => "done" });
    1;
} or do {
    my $err = $@ || "unknown error";
    chomp $err;
    emit({ e => "error", msg => $err });
    exit 1;
};
