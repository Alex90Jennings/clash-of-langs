#include <lauxlib.h>
#include <lua.h>
#include <time.h>

static int now_ns(lua_State *L) {
  struct timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  lua_pushinteger(L, (lua_Integer)t.tv_sec * 1000000000 + t.tv_nsec);
  return 1;
}

int luaopen_clashclock(lua_State *L) {
  lua_pushcfunction(L, now_ns);
  return 1;
}
