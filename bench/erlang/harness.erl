-module(harness).
-export([main/1]).

-define(M, 16#FFFFFFFF).
-define(COUNTRIES, {<<"US">>, <<"GB">>, <<"DE">>, <<"FR">>, <<"JP">>, <<"BR">>, <<"IN">>, <<"CN">>, <<"CA">>, <<"AU">>,
                    <<"NO">>, <<"SE">>, <<"ZA">>, <<"NG">>, <<"MX">>, <<"ES">>, <<"IT">>, <<"KR">>, <<"NL">>, <<"PL">>}).
-define(LEVELS, {<<"INFO">>, <<"WARN">>, <<"ERROR">>, <<"DEBUG">>}).
-define(RESOURCES, {<<"users">>, <<"orders">>, <<"items">>, <<"auth">>, <<"search">>}).
-define(STATUSES, {200, 200, 200, 201, 404, 500}).
-define(REGIONS, {<<"NA">>, <<"EMEA">>, <<"APAC">>, <<"LATAM">>, <<"ANZ">>, <<"MEA">>, <<"NORDICS">>, <<"DACH">>}).
-define(NN_IN, 64).
-define(NN_H, 64).
-define(NN_OUT, 10).
-define(EMB_D, 64).
-define(EMB_Q, 8).
-define(EMB_K, 10).

emit(IoData) -> io:put_chars([IoData, $\n]).
now_ns() -> erlang:monotonic_time(nanosecond).
hex8(H) -> io_lib:format("~8.16.0b", [H]).

rng_seed(Seed) -> put(rng, case Seed band ?M of 0 -> 16#9E3779B9; S -> S end).
rng_next() ->
    X0 = get(rng),
    X1 = X0 bxor ((X0 bsl 13) band ?M),
    X2 = X1 bxor (X1 bsr 17),
    X3 = X2 bxor ((X2 bsl 5) band ?M),
    put(rng, X3),
    X3.
rng_int(N) -> rng_next() rem N.

fold(H, V) -> (H * 31 + V) band ?M.
fold_all(L) -> lists:foldl(fun(V, H) -> fold(H, V) end, 0, L).
fnv1a(Bin) -> fnv1a(Bin, 16#811C9DC5).
fnv1a(<<B, Rest/binary>>, H) -> fnv1a(Rest, ((H bxor B) * 16#01000193) band ?M);
fnv1a(<<>>, H) -> H.

gen(sort, N) ->
    Data = [rng_next() band 16#7FFFFFFF || _ <- lists:seq(1, N)],
    {Data, fold_all(Data), N};
gen(json, N) ->
    Parts = [begin
                 Country = element(rng_int(20) + 1, ?COUNTRIES),
                 Age = 10 + rng_int(80),
                 Score = rng_int(1000),
                 Active = case rng_next() band 1 of 1 -> <<"true">>; 0 -> <<"false">> end,
                 T1 = rng_int(10),
                 T2 = rng_int(10),
                 I = integer_to_binary(Idx),
                 [<<"{\"id\":">>, I, <<",\"name\":\"user_">>, I, <<"\",\"country\":\"">>, Country,
                  <<"\",\"age\":">>, integer_to_binary(Age), <<",\"score\":">>, integer_to_binary(Score),
                  <<",\"active\":">>, Active, <<",\"tags\":[\"t">>, integer_to_binary(T1), <<"\",\"t">>,
                  integer_to_binary(T2), <<"\"]}">>]
             end || Idx <- lists:seq(0, N - 1)],
    Text = iolist_to_binary([$[, lists:join($,, Parts), $]]),
    {Text, fnv1a(Text), N};
gen(strings, N) ->
    Lines = [begin
                 Level = element(rng_int(4) + 1, ?LEVELS),
                 User = rng_int(1000),
                 Res = element(rng_int(5) + 1, ?RESOURCES),
                 Id = rng_int(10000),
                 Status = element(rng_int(6) + 1, ?STATUSES),
                 Latency = rng_int(2000),
                 [<<"ts=">>, integer_to_binary(1700000000 + I), <<" level=">>, Level, <<" user=u">>, integer_to_binary(User),
                  <<" path=/api/">>, Res, $/, integer_to_binary(Id), <<" status=">>, integer_to_binary(Status),
                  <<" latency=">>, integer_to_binary(Latency), <<"ms">>]
             end || I <- lists:seq(0, N - 1)],
    Text = iolist_to_binary(lists:join($\n, Lines)),
    {Text, fnv1a(Text), N};
gen(sieve, N) ->
    {N, N band ?M, N};
gen(records, N) ->
    {Recs, H} = lists:mapfoldl(
                  fun(I, H0) ->
                          C = rng_int(20),
                          Age = 10 + rng_int(80),
                          Score = rng_int(1000),
                          CreatedAt = 1700000000 + rng_int(31536000),
                          Rec = {I, <<"user_", (integer_to_binary(I))/binary>>, element(C + 1, ?COUNTRIES), Age, Score, CreatedAt},
                          {Rec, fold(fold(fold(fold(H0, C), Age), Score), CreatedAt)}
                  end, 0, lists:seq(0, N - 1)),
    {Recs, H, N};
gen(search, N) ->
    Keys = [rng_next() band 16#7FFFFFFF || _ <- lists:seq(1, N)],
    KeyTuple = list_to_tuple(Keys),
    Queries = [case I band 1 of
                   0 -> element(rng_int(N) + 1, KeyTuple);
                   1 -> rng_next() band 16#7FFFFFFF
               end || I <- lists:seq(0, N - 1)],
    {{Keys, Queries}, fold_all(Keys ++ Queries), 2 * N};
gen(csv, N) ->
    Lines = [begin
                 Month = 1 + rng_int(12),
                 Day = 1 + rng_int(28),
                 Region = element(rng_int(8) + 1, ?REGIONS),
                 Sku = rng_int(1000),
                 Qty = 1 + rng_int(20),
                 Price = 99 + rng_int(99901),
                 Discount = 5 * rng_int(5),
                 [integer_to_binary(I), <<",2026-">>, pad2(Month), $-, pad2(Day), $,, Region, <<",SKU-">>, integer_to_binary(Sku),
                  $,, integer_to_binary(Qty), $,, integer_to_binary(Price), $,, integer_to_binary(Discount)]
             end || I <- lists:seq(0, N - 1)],
    Text = iolist_to_binary(lists:join($\n, [<<"order_id,date,region,sku,qty,unit_price_cents,discount_pct">> | Lines])),
    {Text, fnv1a(Text), N};
gen(metrics, N) ->
    {Values, H} = lists:mapfoldl(
                    fun(_, H0) ->
                            V0 = 20 + rng_int(80),
                            V = case rng_int(100) < 3 of
                                    true -> V0 + 200 + rng_int(800);
                                    false -> V0
                                end,
                            {V, fold(H0, V)}
                    end, 0, lists:seq(1, N)),
    {Values, H, N};
gen(infer, N) ->
    {W1, H1} = draw(?NN_H * ?NN_IN, 255, 127, 0),
    {B1, H2} = draw(?NN_H, 2001, 1000, H1),
    {W2, H3} = draw(?NN_H * ?NN_H, 255, 127, H2),
    {B2, H4} = draw(?NN_H, 2001, 1000, H3),
    {W3, H5} = draw(?NN_OUT * ?NN_H, 255, 127, H4),
    {B3, H6} = draw(?NN_OUT, 2001, 1000, H5),
    {X, H} = draw(N * ?NN_IN, 256, 128, H6),
    {{chunk(W1, ?NN_IN), B1, chunk(W2, ?NN_H), B2, chunk(W3, ?NN_H), B3, chunk(X, ?NN_IN)}, H, N};
gen(embed, N) ->
    {Docs, H1} = draw(N * ?EMB_D, 256, 128, 0),
    {Queries, H} = draw(?EMB_Q * ?EMB_D, 256, 128, H1),
    {{chunk(Docs, ?EMB_D), chunk(Queries, ?EMB_D)}, H, N * ?EMB_Q};
gen(pixel, N) ->
    Rgb = << <<(begin
                  R = (X + Y + rng_int(64)) rem 256,
                  G = (2 * X + rng_int(64)) rem 256,
                  B = (2 * Y + rng_int(64)) rem 256,
                  <<R, G, B>>
              end)/binary>> || Y <- lists:seq(0, N - 1), X <- lists:seq(0, N - 1) >>,
    {{Rgb, N}, fold_bytes(Rgb), N * N}.

pad2(V) when V < 10 -> [$0, integer_to_binary(V)];
pad2(V) -> integer_to_binary(V).

draw(Count, K, Offset, H0) ->
    lists:mapfoldl(fun(_, H) -> Raw = rng_int(K), {Raw - Offset, fold(H, Raw)} end, H0, lists:seq(1, Count)).

chunk([], _K) -> [];
chunk(L, K) -> {Row, Rest} = lists:split(K, L), [Row | chunk(Rest, K)].

run(sort, Data) ->
    {lists:sort(Data), undefined};
run(json, Text) ->
    Out = [#{<<"country">> => maps:get(<<"country">>, R),
             <<"id">> => maps:get(<<"id">>, R),
             <<"name">> => string:uppercase(maps:get(<<"name">>, R)),
             <<"score2">> => maps:get(<<"score">>, R) * 2,
             <<"tagCount">> => length(maps:get(<<"tags">>, R))}
           || R <- json:decode(Text), maps:get(<<"active">>, R), maps:get(<<"score">>, R) >= 500],
    {iolist_to_binary(json:encode(Out)), undefined};
run(strings, Text) ->
    {ok, MP} = re:compile(<<"status=(\\d{3}) latency=(\\d+)ms">>),
    {L, S5, E, Lat, T} =
        lists:foldl(
          fun(Line, {L0, S0, E0, Lat0, T0}) ->
                  {S1, Lat1} = case re:run(Line, MP, [{capture, all_but_first, binary}]) of
                                   {match, [St, La]} ->
                                       {S0 + case binary_to_integer(St) >= 500 of true -> 1; false -> 0 end, Lat0 + binary_to_integer(La)};
                                   nomatch -> {S0, Lat0}
                               end,
                  E1 = case binary:match(Line, <<"level=ERROR">>) of nomatch -> E0; _ -> E0 + 1 end,
                  {L0 + 1, S1, E1, Lat1, T0 + length(binary:split(Line, <<" ">>, [global]))}
          end, {0, 0, 0, 0, 0}, binary:split(Text, <<"\n">>, [global])),
    {[L, S5, E, Lat band ?M, T], undefined};
run(sieve, N) ->
    Composite = atomics:new(N + 1, [{signed, false}]),
    mark(2, N, Composite),
    {Count, Sum} = sweep(2, N, Composite, 0, 0),
    {[Count, Sum band ?M], undefined};
run(records, Recs) ->
    Cutoff = 1700000000 + 15768000,
    Groups = lists:foldl(
               fun({_Id, _Name, Country, Age, Score, CreatedAt}, Acc) when Age >= 18, Score >= 100, CreatedAt >= Cutoff ->
                       {C, S, Mx, A} = maps:get(Country, Acc, {0, 0, 0, 0}),
                       Acc#{Country => {C + 1, S + Score, max(Mx, Score), A + Age}};
                  (_, Acc) -> Acc
               end, #{}, Recs),
    Sorted = lists:sort(fun({CA, {_, SA, _, _}}, {CB, {_, SB, _, _}}) -> SA > SB orelse (SA =:= SB andalso CA =< CB) end, maps:to_list(Groups)),
    {Sorted, undefined};
run(search, {Keys, Queries}) ->
    T0 = now_ns(),
    {Index, _} = lists:foldl(fun(K, {Map, I}) -> {Map#{K => I}, I + 1} end, {#{}, 0}, Keys),
    T1 = now_ns(),
    {Hits, Sum} = lists:foldl(fun(Q, {H, S}) ->
                                      case Index of
                                          #{Q := V} -> {H + 1, S + V};
                                          _ -> {H, S}
                                      end
                              end, {0, 0}, Queries),
    T2 = now_ns(),
    Sorted = list_to_tuple(lists:sort(Keys)),
    T3 = now_ns(),
    Size = tuple_size(Sorted),
    BinHits = lists:foldl(fun(Q, Acc) -> case bsearch(Sorted, Q, 1, Size + 1) of true -> Acc + 1; false -> Acc end end, 0, Queries),
    T4 = now_ns(),
    {[Hits, Sum band ?M, BinHits], [T1 - T0, T2 - T1, T3 - T2, T4 - T3]};
run(csv, Text) ->
    [_Header | Lines] = binary:split(Text, <<"\n">>, [global]),
    Groups = lists:foldl(
               fun(Line, Acc) ->
                       [_Id, Date, Region, _Sku, QtyB, PriceB, DiscountB] = binary:split(Line, <<",">>, [global]),
                       Month = binary_to_integer(binary:part(Date, 5, 2)),
                       Qty = binary_to_integer(QtyB),
                       Revenue = Qty * binary_to_integer(PriceB) * (100 - binary_to_integer(DiscountB)) div 100,
                       Key = {Region, Month},
                       case Acc of
                           #{Key := {O, U, R}} -> Acc#{Key := {O + 1, U + Qty, R + Revenue}};
                           _ -> Acc#{Key => {1, Qty, Revenue}}
                       end
               end, #{}, Lines),
    Rows = [[Region, <<",2026-">>, pad2(Month), $,, integer_to_binary(O), $,, integer_to_binary(U), $,, integer_to_binary(R)]
            || {{Region, Month}, {O, U, R}} <- lists:sort(maps:to_list(Groups))],
    {iolist_to_binary(lists:join($\n, [<<"region,month,orders,units,revenue_cents">> | Rows])), undefined};
run(metrics, Values) ->
    N = length(Values),
    {First, Rest} = lists:split(60, Values),
    {Slow, Peak} = window(Rest, Values, lists:sum(First), 0, 0),
    Buckets = buckets(Values, 0, 0, 0),
    Sorted = list_to_tuple(lists:sort(Values)),
    Rank = fun(P) -> element((P * N + 99) div 100, Sorted) end,
    MeanMilli = lists:sum(Values) * 1000 div N,
    {[Slow, Peak, Buckets, Rank(50), Rank(95), Rank(99), element(N, Sorted), MeanMilli band ?M], undefined};
run(infer, {W1, B1, W2, B2, W3, B3, Xs}) ->
    {Preds, Conf} = lists:foldl(
                      fun(X, {P, C}) ->
                              H1 = [min(127, max(0, V) div 1024) || V <- dense(W1, B1, X)],
                              H2 = [min(127, max(0, V) div 1024) || V <- dense(W2, B2, H1)],
                              [L0 | Logits] = dense(W3, B3, H2),
                              {Pred, Best} = argmax(Logits, 1, 0, L0),
                              {fold(P, Pred), (C + Best + 4194304) band ?M}
                      end, {0, 0}, Xs),
    {[Preds, Conf], undefined};
run(embed, {Docs, Queries}) ->
    Indexed = lists:enumerate(0, Docs),
    Results = lists:flatmap(
                fun(Q) ->
                        Ranked = lists:sort([{-dot(D, Q, 0), I} || {I, D} <- Indexed]),
                        lists:flatmap(fun({NegScore, I}) -> [I, 2097152 - NegScore] end, lists:sublist(Ranked, ?EMB_K))
                end, Queries),
    {Results, undefined};
run(pixel, {Rgb, N}) ->
    T0 = now_ns(),
    Gray = << <<((77 * R + 150 * G + 29 * B) bsr 8)>> || <<R, G, B>> <= Rgb >>,
    T1 = now_ns(),
    Blur = << <<(blur_row(Gray, N, Y))/binary>> || Y <- lists:seq(0, N - 1) >>,
    T2 = now_ns(),
    Mag = << <<(sobel_row(Blur, N, Y))/binary>> || Y <- lists:seq(0, N - 1) >>,
    T3 = now_ns(),
    Hist = atomics:new(256, [{signed, false}]),
    Edges = histogram(Mag, Hist, 0),
    Bins = [atomics:get(Hist, I) || I <- lists:seq(1, 256)],
    T4 = now_ns(),
    {Bins ++ [Edges], [T1 - T0, T2 - T1, T3 - T2, T4 - T3]}.

window(Adds, Drops, W, Slow, Peak) ->
    Slow1 = case W > 7200 of true -> Slow + 1; false -> Slow end,
    Peak1 = max(Peak, W),
    case Adds of
        [] -> {Slow1, Peak1};
        [A | As] -> [D | Ds] = Drops, window(As, Ds, W + A - D, Slow1, Peak1)
    end.

buckets([_ | _] = Vs, 60, Max, H) -> buckets(Vs, 0, 0, fold(H, Max));
buckets([V | Vs], Count, Max, H) -> buckets(Vs, Count + 1, max(Max, V), H);
buckets([], _Count, Max, H) -> fold(H, Max).

dot([A | As], [B | Bs], Acc) -> dot(As, Bs, Acc + A * B);
dot([], [], Acc) -> Acc.

dense(W, B, X) -> lists:zipwith(fun(Row, Bias) -> dot(Row, X, Bias) end, W, B).

argmax([L | Ls], I, _BestI, BestV) when L > BestV -> argmax(Ls, I + 1, I, L);
argmax([_ | Ls], I, BestI, BestV) -> argmax(Ls, I + 1, BestI, BestV);
argmax([], _I, BestI, BestV) -> {BestI, BestV}.

clamp(V, _N) when V < 0 -> 0;
clamp(V, N) when V >= N -> N - 1;
clamp(V, _N) -> V.

blur_row(Gray, N, Y) ->
    Ru = clamp(Y - 1, N) * N, R0 = Y * N, Rd = clamp(Y + 1, N) * N,
    << <<(begin
              Xl = clamp(X - 1, N), Xr = clamp(X + 1, N),
              S = binary:at(Gray, Ru + Xl) + 2 * binary:at(Gray, Ru + X) + binary:at(Gray, Ru + Xr)
                  + 2 * binary:at(Gray, R0 + Xl) + 4 * binary:at(Gray, R0 + X) + 2 * binary:at(Gray, R0 + Xr)
                  + binary:at(Gray, Rd + Xl) + 2 * binary:at(Gray, Rd + X) + binary:at(Gray, Rd + Xr),
              S bsr 4
          end)>> || X <- lists:seq(0, N - 1) >>.

sobel_row(Blur, N, Y) ->
    Ru = clamp(Y - 1, N) * N, R0 = Y * N, Rd = clamp(Y + 1, N) * N,
    << <<(begin
              Xl = clamp(X - 1, N), Xr = clamp(X + 1, N),
              Gx = binary:at(Blur, Ru + Xr) + 2 * binary:at(Blur, R0 + Xr) + binary:at(Blur, Rd + Xr)
                   - (binary:at(Blur, Ru + Xl) + 2 * binary:at(Blur, R0 + Xl) + binary:at(Blur, Rd + Xl)),
              Gy = binary:at(Blur, Rd + Xl) + 2 * binary:at(Blur, Rd + X) + binary:at(Blur, Rd + Xr)
                   - (binary:at(Blur, Ru + Xl) + 2 * binary:at(Blur, Ru + X) + binary:at(Blur, Ru + Xr)),
              min(255, abs(Gx) + abs(Gy))
          end)>> || X <- lists:seq(0, N - 1) >>.

histogram(<<M, Rest/binary>>, Hist, Edges) ->
    atomics:add(Hist, M + 1, 1),
    histogram(Rest, Hist, case M >= 128 of true -> Edges + 1; false -> Edges end);
histogram(<<>>, _Hist, Edges) -> Edges.

mark(I, N, _A) when I * I > N -> ok;
mark(I, N, A) ->
    case atomics:get(A, I + 1) of
        0 -> cross(I * I, I, N, A);
        _ -> ok
    end,
    mark(I + 1, N, A).
cross(J, _I, N, _A) when J > N -> ok;
cross(J, I, N, A) -> atomics:put(A, J + 1, 1), cross(J + I, I, N, A).
sweep(K, N, _A, C, S) when K > N -> {C, S};
sweep(K, N, A, C, S) ->
    case atomics:get(A, K + 1) of
        0 -> sweep(K + 1, N, A, C + 1, S + K);
        _ -> sweep(K + 1, N, A, C, S)
    end.

bsearch(T, Q, Lo, Hi) when Lo < Hi ->
    Mid = (Lo + Hi) div 2,
    case element(Mid, T) < Q of
        true -> bsearch(T, Q, Mid + 1, Hi);
        false -> bsearch(T, Q, Lo, Mid)
    end;
bsearch(T, Q, Lo, _Hi) -> Lo =< tuple_size(T) andalso element(Lo, T) =:= Q.

check(sort, Sorted) -> fold_all(Sorted);
check(json, Json) -> fnv1a(Json);
check(csv, Report) -> fnv1a(Report);
check(records, Groups) ->
    lists:foldl(fun({Country, {C, S, Mx, A}}, H) ->
                        fold(fold(fold(fold(fold(H, fnv1a(Country)), C), S band ?M), Mx), A band ?M)
                end, 0, Groups);
check(_, Counters) -> fold_all(Counters).

fold_bytes(Bin) -> fold_bytes(Bin, 0).
fold_bytes(<<B, Rest/binary>>, H) -> fold_bytes(Rest, fold(H, B));
fold_bytes(<<>>, H) -> H.

main(Args) ->
    emit(<<"{\"e\":\"hello\",\"lang\":\"erlang\"}">>),
    try
        [NameS, SizeS, SeedS, WarmS, RunsS | _] = Args,
        Name = case NameS of
                   "sort" -> sort; "json" -> json; "strings" -> strings;
                   "sieve" -> sieve; "records" -> records; "search" -> search;
                   "csv" -> csv; "metrics" -> metrics; "infer" -> infer; "embed" -> embed; "pixel" -> pixel;
                   _ -> throw({unknown, NameS})
               end,
        [Size, Seed, Warmup, Runs] = [list_to_integer(S) || S <- [SizeS, SeedS, WarmS, RunsS]],
        rng_seed(Seed),
        G0 = now_ns(),
        {Input, Hash, Ops} = gen(Name, Size),
        emit(io_lib:format("{\"e\":\"ready\",\"genNs\":~b,\"input\":\"~s\",\"ops\":~b}", [now_ns() - G0, hex8(Hash), Ops])),
        lists:foreach(
          fun(I) ->
                  T0 = now_ns(),
                  {Out, Phases} = run(Name, Input),
                  Ns = now_ns() - T0,
                  Warm = I < Warmup,
                  PhasesJson = case Phases of
                                   undefined -> "";
                                   _ -> [",\"phases\":[", lists:join(",", [integer_to_list(P) || P <- Phases]), "]"]
                               end,
                  emit(io_lib:format("{\"e\":\"~s\",\"i\":~b,\"ns\":~b,\"check\":\"~s\"~s}",
                                     [case Warm of true -> "warmup"; false -> "run" end,
                                      case Warm of true -> I; false -> I - Warmup end, Ns, hex8(check(Name, Out)), PhasesJson]))
          end, lists:seq(0, Warmup + Runs - 1)),
        emit(<<"{\"e\":\"done\"}">>),
        halt(0)
    catch
        _:Reason ->
            emit(io_lib:format("{\"e\":\"error\",\"msg\":~s}", [json:encode(iolist_to_binary(io_lib:format("~p", [Reason])))])),
            halt(1)
    end.
