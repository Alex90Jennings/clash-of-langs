here <- dirname(sub("^--file=", "", grep("^--file=", commandArgs(FALSE), value = TRUE)[1]))
.libPaths(c(file.path(here, "lib"), .libPaths()))
dyn.load(file.path(here, "clashhelpers.so"))
suppressPackageStartupMessages(library(jsonlite))

emit <- function(s) {
  cat(s, "\n", sep = "")
  flush(stdout())
}
emit('{"e":"hello","lang":"r"}')

TWO32 <- 4294967296
TWO31 <- 2147483648
COUNTRIES <- c("US", "GB", "DE", "FR", "JP", "BR", "IN", "CN", "CA", "AU", "NO", "SE", "ZA", "NG", "MX", "ES", "IT", "KR", "NL", "PL")
LEVELS <- c("INFO", "WARN", "ERROR", "DEBUG")
RESOURCES <- c("users", "orders", "items", "auth", "search")
STATUSES <- c(200L, 200L, 200L, 201L, 404L, 500L)

stream <- function(seed, n) .Call("clash_stream", as.numeric(seed), as.numeric(n))
fold_all <- function(v) .Call("clash_fold_all", v)
fnv1a <- function(s) .Call("clash_fnv1a", s)
now_ns <- function() .Call("clash_now_ns")
hex8 <- function(h) sprintf("%04x%04x", as.integer(h %/% 65536), as.integer(h %% 65536))
draws <- function(seed, n, per) matrix(stream(seed, n * per), ncol = per, byrow = TRUE)

gen <- list(
  sort = function(n, seed) {
    data <- as.integer(stream(seed, n) %% TWO31)
    list(data, fold_all(data), n)
  },
  json = function(n, seed) {
    d <- draws(seed, n, 6)
    i <- seq_len(n) - 1L
    text <- paste0("[", paste0(sprintf('{"id":%d,"name":"user_%d","country":"%s","age":%d,"score":%d,"active":%s,"tags":["t%d","t%d"]}',
      i, i, COUNTRIES[d[, 1] %% 20 + 1], as.integer(10 + d[, 2] %% 80), as.integer(d[, 3] %% 1000),
      ifelse(d[, 4] %% 2 == 1, "true", "false"), as.integer(d[, 5] %% 10), as.integer(d[, 6] %% 10)), collapse = ","), "]")
    list(text, fnv1a(text), n)
  },
  strings = function(n, seed) {
    d <- draws(seed, n, 6)
    text <- paste(sprintf("ts=%.0f level=%s user=u%d path=/api/%s/%d status=%d latency=%dms",
      1700000000 + seq_len(n) - 1, LEVELS[d[, 1] %% 4 + 1], as.integer(d[, 2] %% 1000), RESOURCES[d[, 3] %% 5 + 1],
      as.integer(d[, 4] %% 10000), STATUSES[d[, 5] %% 6 + 1], as.integer(d[, 6] %% 2000)), collapse = "\n")
    list(text, fnv1a(text), n)
  },
  sieve = function(n, seed) list(n, n %% TWO32, n),
  records = function(n, seed) {
    d <- draws(seed, n, 4)
    c <- d[, 1] %% 20
    df <- data.frame(id = seq_len(n) - 1L, name = paste0("user_", seq_len(n) - 1L), country = COUNTRIES[c + 1],
      age = as.integer(10 + d[, 2] %% 80), score = as.integer(d[, 3] %% 1000), created_at = 1700000000 + d[, 4] %% 31536000)
    list(df, fold_all(as.numeric(t(cbind(c, df$age, df$score, df$created_at)))), n)
  },
  search = function(n, seed) {
    d <- stream(seed, 2 * n)
    keys <- as.integer(d[1:n] %% TWO31)
    q <- d[(n + 1):(2 * n)]
    even <- (seq_len(n) - 1L) %% 2L == 0L
    queries <- integer(n)
    queries[even] <- keys[q[even] %% n + 1]
    queries[!even] <- as.integer(q[!even] %% TWO31)
    list(list(keys = keys, queries = queries), fold_all(c(keys, queries)), 2 * n)
  }
)

run <- list(
  sort = function(data) list(value = sort(data)),
  json = function(text) {
    df <- fromJSON(text)
    keep <- df$active & df$score >= 500
    out <- data.frame(country = df$country[keep], id = df$id[keep], name = toupper(df$name[keep]),
      score2 = as.integer(df$score[keep] * 2L), tagCount = lengths(df$tags[keep]))
    list(value = as.character(toJSON(out)))
  },
  strings = function(text) {
    lines <- strsplit(text, "\n", fixed = TRUE)[[1]]
    m <- regmatches(lines, regexec("status=([0-9]{3}) latency=([0-9]+)ms", lines))
    caps <- matrix(unlist(m[lengths(m) == 3]), ncol = 3, byrow = TRUE)
    s5xx <- sum(as.integer(caps[, 2]) >= 500)
    latency <- sum(as.numeric(caps[, 3]))
    errors <- sum(grepl("level=ERROR", lines, fixed = TRUE))
    tokens <- sum(lengths(strsplit(lines, " ", fixed = TRUE)))
    list(value = c(length(lines), s5xx, errors, latency %% TWO32, tokens))
  },
  sieve = function(n) {
    composite <- logical(n + 1)
    composite[1:2] <- TRUE
    for (i in 2:max(2, floor(sqrt(n)))) {
      if (i * i <= n && !composite[i + 1]) composite[seq(i * i, n, by = i) + 1] <- TRUE
    }
    primes <- which(!composite) - 1
    list(value = c(length(primes), sum(primes) %% TWO32))
  },
  records = function(df) {
    d <- df[df$age >= 18 & df$score >= 100 & df$created_at >= 1700000000 + 15768000, c("country", "score", "age")]
    sums <- rowsum(cbind(count = 1, sum = d$score, age_sum = d$age), group = d$country)
    mx <- tapply(d$score, d$country, max)[rownames(sums)]
    g <- data.frame(country = rownames(sums), count = sums[, "count"], sum = sums[, "sum"], max = as.numeric(mx), age_sum = sums[, "age_sum"])
    list(value = g[order(-g$sum, g$country, method = "radix"), ])
  },
  search = function(input) {
    keys <- input$keys
    queries <- input$queries
    phases <- numeric(4)
    t <- now_ns()
    last <- !duplicated(keys, fromLast = TRUE)
    index_keys <- keys[last]
    index_pos <- which(last) - 1
    now <- now_ns(); phases[1] <- now - t; t <- now
    idx <- match(queries, index_keys)
    found <- !is.na(idx)
    hits <- sum(found)
    total <- sum(index_pos[idx[found]])
    now <- now_ns(); phases[2] <- now - t; t <- now
    sorted <- sort(keys)
    now <- now_ns(); phases[3] <- now - t; t <- now
    p <- findInterval(queries, sorted)
    bin_hits <- sum(p > 0 & sorted[pmax(p, 1)] == queries)
    now <- now_ns(); phases[4] <- now - t
    list(value = c(hits, total %% TWO32, bin_hits), phases = phases)
  }
)

REGIONS <- c("NA", "EMEA", "APAC", "LATAM", "ANZ", "MEA", "NORDICS", "DACH")
NN_IN <- 64; NN_H <- 64; NN_OUT <- 10
EMB_D <- 64; EMB_Q <- 8; EMB_K <- 10

gen$csv <- function(n, seed) {
  d <- draws(seed, n, 7)
  rows <- sprintf("%d,2026-%02d-%02d,%s,SKU-%d,%d,%d,%d", seq_len(n) - 1L, as.integer(1 + d[, 1] %% 12), as.integer(1 + d[, 2] %% 28),
    REGIONS[d[, 3] %% 8 + 1], as.integer(d[, 4] %% 1000), as.integer(1 + d[, 5] %% 20), as.integer(99 + d[, 6] %% 99901), as.integer(5 * (d[, 7] %% 5)))
  text <- paste(c("order_id,date,region,sku,qty,unit_price_cents,discount_pct", rows), collapse = "\n")
  list(text, fnv1a(text), n)
}
gen$metrics <- function(n, seed) {
  d <- stream(seed, 3 * n)
  values <- numeric(n)
  p <- 1
  for (i in seq_len(n)) {
    v <- 20 + d[p] %% 80
    extra <- d[p + 1] %% 100 < 3
    p <- p + 2
    if (extra) { v <- v + 200 + d[p] %% 800; p <- p + 1 }
    values[i] <- v
  }
  list(as.integer(values), fold_all(values), n)
}
gen$infer <- function(n, seed) {
  sizes <- c(NN_H * NN_IN, NN_H, NN_H * NN_H, NN_H, NN_OUT * NN_H, NN_OUT, n * NN_IN)
  raw <- stream(seed, sum(sizes))
  part <- split(raw, rep(seq_along(sizes), sizes))
  weights <- function(k, rows, cols) matrix(part[[k]] %% 255 - 127, nrow = rows, ncol = cols, byrow = TRUE)
  biases <- function(k) part[[k]] %% 2001 - 1000
  m <- list(w1 = weights(1, NN_H, NN_IN), b1 = biases(2), w2 = weights(3, NN_H, NN_H), b2 = biases(4),
    w3 = weights(5, NN_OUT, NN_H), b3 = biases(6), x = matrix(part[[7]] %% 256 - 128, nrow = NN_IN))
  list(m, fold_all(c(part[[1]] %% 255, part[[2]] %% 2001, part[[3]] %% 255, part[[4]] %% 2001, part[[5]] %% 255, part[[6]] %% 2001, part[[7]] %% 256)), n)
}
gen$embed <- function(n, seed) {
  raw <- stream(seed, (n + EMB_Q) * EMB_D) %% 256
  docs <- matrix(raw[seq_len(n * EMB_D)] - 128, nrow = EMB_D)
  queries <- matrix(raw[-seq_len(n * EMB_D)] - 128, nrow = EMB_D)
  list(list(docs = docs, queries = queries), fold_all(raw), n * EMB_Q)
}
gen$pixel <- function(n, seed) {
  d <- draws(seed, n * n, 3) %% 64
  p <- seq_len(n * n) - 1
  x <- p %% n; y <- p %/% n
  r <- as.integer((x + y + d[, 1]) %% 256)
  g <- as.integer((2 * x + d[, 2]) %% 256)
  b <- as.integer((2 * y + d[, 3]) %% 256)
  img <- list(r = matrix(r, nrow = n, byrow = TRUE), g = matrix(g, nrow = n, byrow = TRUE), b = matrix(b, nrow = n, byrow = TRUE))
  list(img, fold_all(as.vector(rbind(r, g, b))), n * n)
}

run$csv <- function(text) {
  lines <- strsplit(text, "\n", fixed = TRUE)[[1]][-1]
  f <- matrix(unlist(strsplit(lines, ",", fixed = TRUE)), ncol = 7, byrow = TRUE)
  qty <- as.numeric(f[, 5])
  d <- data.frame(region = f[, 3], month = as.integer(substr(f[, 2], 6, 7)), orders = 1, units = qty,
    revenue = (qty * as.numeric(f[, 6]) * (100 - as.numeric(f[, 7]))) %/% 100)
  g <- aggregate(cbind(orders, units, revenue) ~ region + month, data = d, FUN = sum)
  g <- g[order(g$region, g$month, method = "radix"), ]
  report <- paste(c("region,month,orders,units,revenue_cents",
    sprintf("%s,2026-%02d,%.0f,%.0f,%.0f", g$region, g$month, g$orders, g$units, g$revenue)), collapse = "\n")
  list(value = report)
}
run$metrics <- function(values) {
  n <- length(values)
  cs <- cumsum(as.numeric(values))
  window <- cs[60:n] - c(0, cs[seq_len(n - 60)])
  sorted <- sort(values)
  rank <- function(p) sorted[(p * n + 99) %/% 100]
  maxima <- tapply(values, (seq_len(n) - 1) %/% 60, max)
  list(value = list(head = c(sum(window > 7200), max(window)), maxima = as.vector(maxima),
    tail = c(rank(50), rank(95), rank(99), sorted[n], (cs[n] * 1000) %/% n %% TWO32)))
}
run$infer <- function(m) {
  relu <- function(a) pmin(pmax(a, 0) %/% 1024, 127)
  h1 <- relu(m$w1 %*% m$x + m$b1)
  h2 <- relu(m$w2 %*% h1 + m$b2)
  logits <- m$w3 %*% h2 + m$b3
  pred <- max.col(t(logits), ties.method = "first")
  conf <- sum(logits[cbind(pred, seq_along(pred))] + 4194304) %% TWO32
  list(value = list(preds = pred - 1, conf = conf))
}
run$embed <- function(input) {
  scores <- crossprod(input$docs, input$queries)
  top <- lapply(seq_len(EMB_Q), function(q) {
    s <- scores[, q]
    o <- order(-s)[seq_len(EMB_K)]
    rbind(o - 1, s[o] + 2097152)
  })
  list(value = unlist(top))
}
run$pixel <- function(img) {
  n <- nrow(img$r)
  phases <- numeric(4)
  t <- now_ns()
  prev <- pmax(seq_len(n) - 1L, 1L); nxt <- pmin(seq_len(n) + 1L, n)
  gray <- (77L * img$r + 150L * img$g + 29L * img$b) %/% 256L
  now <- now_ns(); phases[1] <- now - t; t <- now
  blur <- (gray[prev, prev] + 2L * gray[prev, ] + gray[prev, nxt] + 2L * gray[, prev] + 4L * gray + 2L * gray[, nxt] +
    gray[nxt, prev] + 2L * gray[nxt, ] + gray[nxt, nxt]) %/% 16L
  now <- now_ns(); phases[2] <- now - t; t <- now
  gx <- (blur[prev, nxt] + 2L * blur[, nxt] + blur[nxt, nxt]) - (blur[prev, prev] + 2L * blur[, prev] + blur[nxt, prev])
  gy <- (blur[nxt, prev] + 2L * blur[nxt, ] + blur[nxt, nxt]) - (blur[prev, prev] + 2L * blur[prev, ] + blur[prev, nxt])
  mag <- pmin(abs(gx) + abs(gy), 255L)
  now <- now_ns(); phases[3] <- now - t; t <- now
  hist <- tabulate(mag + 1L, nbins = 256)
  edges <- sum(mag >= 128L)
  now <- now_ns(); phases[4] <- now - t
  list(value = c(hist, edges), phases = phases)
}

check <- function(name, value) {
  switch(name,
    json = fnv1a(value),
    records = fold_all(as.numeric(t(cbind(vapply(value$country, fnv1a, numeric(1)), value$count, value$sum %% TWO32, value$max, value$age_sum %% TWO32)))),
    csv = fnv1a(value),
    metrics = fold_all(c(value$head, fold_all(value$maxima), value$tail)),
    infer = fold_all(c(fold_all(value$preds), value$conf)),
    fold_all(as.numeric(value))
  )
}

result <- tryCatch({
  args <- commandArgs(trailingOnly = TRUE)
  name <- args[1]
  if (is.null(gen[[name]])) stop(paste("unknown challenge:", name))
  size <- as.numeric(args[2]); seed <- as.numeric(args[3]); warmup <- as.integer(args[4]); runs <- as.integer(args[5])
  g0 <- now_ns()
  g <- gen[[name]](size, seed)
  emit(sprintf('{"e":"ready","genNs":%.0f,"input":"%s","ops":%.0f}', now_ns() - g0, hex8(g[[2]]), g[[3]]))
  for (i in seq_len(warmup + runs) - 1) {
    t0 <- now_ns()
    out <- run[[name]](g[[1]])
    ns <- now_ns() - t0
    warm <- i < warmup
    ph <- if (is.null(out$phases)) "" else sprintf(',"phases":[%s]', paste(sprintf("%.0f", out$phases), collapse = ","))
    emit(sprintf('{"e":"%s","i":%d,"ns":%.0f,"check":"%s"%s}', if (warm) "warmup" else "run", as.integer(if (warm) i else i - warmup), ns, hex8(check(name, out$value)), ph))
  }
  emit('{"e":"done"}')
  0L
}, error = function(e) {
  emit(sprintf('{"e":"error","msg":%s}', toJSON(conditionMessage(e), auto_unbox = TRUE)))
  1L
})
quit(status = result, save = "no")
