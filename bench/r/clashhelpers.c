#include <R.h>
#include <Rinternals.h>
#include <stdint.h>
#include <time.h>

SEXP clash_stream(SEXP seed_, SEXP n_) {
  uint32_t s = (uint32_t)asReal(seed_);
  if (s == 0) s = 0x9e3779b9u;
  R_xlen_t n = (R_xlen_t)asReal(n_);
  SEXP out = PROTECT(allocVector(REALSXP, n));
  double *p = REAL(out);
  for (R_xlen_t i = 0; i < n; i++) {
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    p[i] = (double)s;
  }
  UNPROTECT(1);
  return out;
}

SEXP clash_fold_all(SEXP v_) {
  uint32_t h = 0;
  R_xlen_t n = XLENGTH(v_);
  if (TYPEOF(v_) == INTSXP) {
    int *p = INTEGER(v_);
    for (R_xlen_t i = 0; i < n; i++) h = h * 31u + (uint32_t)p[i];
  } else {
    double *p = REAL(v_);
    for (R_xlen_t i = 0; i < n; i++) h = h * 31u + (uint32_t)(uint64_t)p[i];
  }
  return ScalarReal((double)h);
}

SEXP clash_fnv1a(SEXP s_) {
  const char *s = CHAR(STRING_ELT(s_, 0));
  uint32_t h = 0x811c9dc5u;
  for (; *s; s++) h = (h ^ (unsigned char)*s) * 0x01000193u;
  return ScalarReal((double)h);
}

SEXP clash_now_ns(void) {
  struct timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return ScalarReal((double)t.tv_sec * 1e9 + (double)t.tv_nsec);
}
