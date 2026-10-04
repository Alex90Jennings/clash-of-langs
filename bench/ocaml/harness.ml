let m = 0xFFFFFFFF
let countries = [| "US"; "GB"; "DE"; "FR"; "JP"; "BR"; "IN"; "CN"; "CA"; "AU"; "NO"; "SE"; "ZA"; "NG"; "MX"; "ES"; "IT"; "KR"; "NL"; "PL" |]
let levels = [| "INFO"; "WARN"; "ERROR"; "DEBUG" |]
let resources = [| "users"; "orders"; "items"; "auth"; "search" |]
let statuses = [| 200; 200; 200; 201; 404; 500 |]

let emit s = print_string s; print_char '\n'; flush stdout
let now_ns () = Int64.to_int (Mtime.to_uint64_ns (Mtime_clock.now ()))
let hex8 h = Printf.sprintf "%08x" (h land m)

let state = ref 0
let rng_seed s = state := (if s land m = 0 then 0x9E3779B9 else s land m)
let rng_next () =
  let x = !state in
  let x = x lxor ((x lsl 13) land m) in
  let x = x lxor (x lsr 17) in
  let x = x lxor ((x lsl 5) land m) in
  state := x;
  x
let rng_int n = rng_next () mod n

let fold h v = (h * 31 + v) land m
let fold_all l = List.fold_left fold 0 l
let fnv1a s =
  let h = ref 0x811C9DC5 in
  String.iter (fun c -> h := ((!h lxor Char.code c) * 0x01000193) land m) s;
  !h


type challenge = { run : unit -> unit; prepare : unit -> unit; check : unit -> int; phases : unit -> int list option }

let sort_challenge n =
  let data = Array.init n (fun _ -> rng_next () land 0x7FFFFFFF) in
  let work = ref [||] in
  let hash = Array.fold_left fold 0 data in
  ( hash, n,
    { prepare = (fun () -> work := Array.copy data);
      run = (fun () -> Array.sort compare !work);
      check = (fun () -> Array.fold_left fold 0 !work);
      phases = (fun () -> None) } )

let json_challenge n =
  let b = Buffer.create (n * 110) in
  Buffer.add_char b '[';
  for i = 0 to n - 1 do
    let country = countries.(rng_int 20) in
    let age = 10 + rng_int 80 in
    let score = rng_int 1000 in
    let active = rng_next () land 1 = 1 in
    let t1 = rng_int 10 in
    let t2 = rng_int 10 in
    if i > 0 then Buffer.add_char b ',';
    Printf.bprintf b {|{"id":%d,"name":"user_%d","country":"%s","age":%d,"score":%d,"active":%b,"tags":["t%d","t%d"]}|} i i country age score active t1 t2
  done;
  Buffer.add_char b ']';
  let text = Buffer.contents b in
  let result = ref "" in
  let open Yojson.Safe.Util in
  ( fnv1a text, n,
    { prepare = ignore;
      run = (fun () ->
        let records = Yojson.Safe.from_string text |> to_list in
        let out =
          List.filter_map
            (fun r ->
              let score = r |> member "score" |> to_int in
              if r |> member "active" |> to_bool && score >= 500 then
                Some (`Assoc [ ("country", member "country" r); ("id", member "id" r);
                               ("name", `String (String.uppercase_ascii (r |> member "name" |> to_string)));
                               ("score2", `Int (score * 2)); ("tagCount", `Int (List.length (r |> member "tags" |> to_list))) ])
              else None)
            records
        in
        result := Yojson.Safe.to_string (`List out));
      check = (fun () -> fnv1a !result);
      phases = (fun () -> None) } )

let strings_challenge n =
  let lines = List.init n (fun i ->
    let level = levels.(rng_int 4) in
    let user = rng_int 1000 in
    let res = resources.(rng_int 5) in
    let id = rng_int 10000 in
    let status = statuses.(rng_int 6) in
    let latency = rng_int 2000 in
    Printf.sprintf "ts=%d level=%s user=u%d path=/api/%s/%d status=%d latency=%dms" (1700000000 + i) level user res id status latency) in
  let text = String.concat "\n" lines in
  let counters = ref [] in
  ( fnv1a text, n,
    { prepare = ignore;
      run = (fun () ->
        let pattern = Str.regexp {|status=\([0-9][0-9][0-9]\) latency=\([0-9]+\)ms|} in
        let error = Str.regexp_string "level=ERROR" in
        let lines = ref 0 and s5xx = ref 0 and errors = ref 0 and latency = ref 0 and tokens = ref 0 in
        List.iter
          (fun line ->
            incr lines;
            (match Str.search_forward pattern line 0 with
             | _ ->
               if int_of_string (Str.matched_group 1 line) >= 500 then incr s5xx;
               latency := !latency + int_of_string (Str.matched_group 2 line)
             | exception Not_found -> ());
            (match Str.search_forward error line 0 with _ -> incr errors | exception Not_found -> ());
            tokens := !tokens + List.length (String.split_on_char ' ' line))
          (String.split_on_char '\n' text);
        counters := [ !lines; !s5xx; !errors; !latency land m; !tokens ]);
      check = (fun () -> fold_all !counters);
      phases = (fun () -> None) } )

let sieve_challenge n =
  let counters = ref [] in
  ( n land m, n,
    { prepare = ignore;
      run = (fun () ->
        let composite = Bytes.make (n + 1) '\000' in
        let i = ref 2 in
        while !i * !i <= n do
          if Bytes.unsafe_get composite !i = '\000' then begin
            let j = ref (!i * !i) in
            while !j <= n do Bytes.unsafe_set composite !j '\001'; j := !j + !i done
          end;
          incr i
        done;
        let count = ref 0 and sum = ref 0 in
        for k = 2 to n do
          if Bytes.unsafe_get composite k = '\000' then (incr count; sum := !sum + k)
        done;
        counters := [ !count; !sum land m ]);
      check = (fun () -> fold_all !counters);
      phases = (fun () -> None) } )

type record = { id : int; name : string; country : string; age : int; score : int; created_at : int }
type agg = { g_country : string; mutable count : int; mutable sum : int; mutable max : int; mutable age_sum : int }

let records_challenge n =
  let h = ref 0 in
  let records = Array.init n (fun i ->
    let c = rng_int 20 in
    let age = 10 + rng_int 80 in
    let score = rng_int 1000 in
    let created_at = 1700000000 + rng_int 31536000 in
    h := fold (fold (fold (fold !h c) age) score) created_at;
    { id = i; name = "user_" ^ string_of_int i; country = countries.(c); age; score; created_at }) in
  let groups = ref [] in
  ( !h, n,
    { prepare = ignore;
      run = (fun () ->
        let cutoff = 1700000000 + 15768000 in
        let tbl = Hashtbl.create 32 in
        Array.iter
          (fun r ->
            if r.age >= 18 && r.score >= 100 && r.created_at >= cutoff then begin
              let g =
                match Hashtbl.find_opt tbl r.country with
                | Some g -> g
                | None -> let g = { g_country = r.country; count = 0; sum = 0; max = 0; age_sum = 0 } in Hashtbl.add tbl r.country g; g
              in
              g.count <- g.count + 1;
              g.sum <- g.sum + r.score;
              if r.score > g.max then g.max <- r.score;
              g.age_sum <- g.age_sum + r.age
            end)
          records;
        groups := Hashtbl.fold (fun _ g acc -> g :: acc) tbl []
                  |> List.sort (fun a b -> if a.sum <> b.sum then compare b.sum a.sum else compare a.g_country b.g_country));
      check = (fun () ->
        List.fold_left (fun h g -> fold (fold (fold (fold (fold h (fnv1a g.g_country)) g.count) (g.sum land m)) g.max) (g.age_sum land m)) 0 !groups);
      phases = (fun () -> None) } )

let search_challenge n =
  let keys = Array.init n (fun _ -> rng_next () land 0x7FFFFFFF) in
  let queries = Array.init n (fun i -> if i land 1 = 0 then keys.(rng_int n) else rng_next () land 0x7FFFFFFF) in
  let hash = Array.fold_left fold (Array.fold_left fold 0 keys) queries in
  let counters = ref [] and phases = ref [] in
  ( hash, 2 * n,
    { prepare = ignore;
      run = (fun () ->
        let t = ref (now_ns ()) and ph = ref [] in
        let lap () = let now = now_ns () in ph := (now - !t) :: !ph; t := now in
        let index = Hashtbl.create n in
        Array.iteri (fun i k -> Hashtbl.replace index k i) keys;
        lap ();
        let hits = ref 0 and sum = ref 0 in
        Array.iter (fun q -> match Hashtbl.find_opt index q with Some v -> incr hits; sum := !sum + v | None -> ()) queries;
        lap ();
        let sorted = Array.copy keys in
        Array.sort compare sorted;
        lap ();
        let size = Array.length sorted in
        let bin_hits = ref 0 in
        Array.iter
          (fun q ->
            let lo = ref 0 and hi = ref size in
            while !lo < !hi do
              let mid = (!lo + !hi) / 2 in
              if sorted.(mid) < q then lo := mid + 1 else hi := mid
            done;
            if !lo < size && sorted.(!lo) = q then incr bin_hits)
          queries;
        lap ();
        counters := [ !hits; !sum land m; !bin_hits ];
        phases := List.rev !ph);
      check = (fun () -> fold_all !counters);
      phases = (fun () -> Some !phases) } )

let regions = [| "NA"; "EMEA"; "APAC"; "LATAM"; "ANZ"; "MEA"; "NORDICS"; "DACH" |]

type csv_group = { mutable orders : int; mutable units : int; mutable revenue : int }

let csv_challenge n =
  let b = Buffer.create (n * 48) in
  Buffer.add_string b "order_id,date,region,sku,qty,unit_price_cents,discount_pct";
  for i = 0 to n - 1 do
    let month = 1 + rng_int 12 in
    let day = 1 + rng_int 28 in
    let region = regions.(rng_int 8) in
    let sku = rng_int 1000 in
    let qty = 1 + rng_int 20 in
    let price = 99 + rng_int 99901 in
    let discount = 5 * rng_int 5 in
    Printf.bprintf b "\n%d,2026-%02d-%02d,%s,SKU-%d,%d,%d,%d" i month day region sku qty price discount
  done;
  let text = Buffer.contents b in
  let report = ref "" in
  ( fnv1a text, n,
    { prepare = ignore;
      run = (fun () ->
        let tbl = Hashtbl.create 128 in
        List.iter
          (fun line ->
            match String.split_on_char ',' line with
            | [ _; date; region; _; qty; price; discount ] ->
              let month = int_of_string (String.sub date 5 2) and qty = int_of_string qty in
              let revenue = qty * int_of_string price * (100 - int_of_string discount) / 100 in
              let g =
                match Hashtbl.find_opt tbl (region, month) with
                | Some g -> g
                | None -> let g = { orders = 0; units = 0; revenue = 0 } in Hashtbl.add tbl (region, month) g; g
              in
              g.orders <- g.orders + 1;
              g.units <- g.units + qty;
              g.revenue <- g.revenue + revenue
            | _ -> ())
          (List.tl (String.split_on_char '\n' text));
        let rows = Hashtbl.fold (fun key g acc -> (key, g) :: acc) tbl [] |> List.sort (fun (a, _) (b, _) -> compare a b) in
        let out = Buffer.create 4096 in
        Buffer.add_string out "region,month,orders,units,revenue_cents";
        List.iter (fun ((region, month), g) -> Printf.bprintf out "\n%s,2026-%02d,%d,%d,%d" region month g.orders g.units g.revenue) rows;
        report := Buffer.contents out);
      check = (fun () -> fnv1a !report);
      phases = (fun () -> None) } )

let metrics_challenge n =
  let values = Array.init n (fun _ -> let v = 20 + rng_int 80 in if rng_int 100 < 3 then v + 200 + rng_int 800 else v) in
  let result = ref [] in
  ( Array.fold_left fold 0 values, n,
    { prepare = ignore;
      run = (fun () ->
        let window = ref 0 and slow = ref 0 and peak = ref 0 and total = ref 0 in
        Array.iteri
          (fun i v ->
            window := !window + v;
            total := !total + v;
            if i >= 60 then window := !window - values.(i - 60);
            if i >= 59 then begin
              if !window > 7200 then incr slow;
              if !window > !peak then peak := !window
            end)
          values;
        let buckets = ref 0 and start = ref 0 in
        while !start < n do
          let mx = ref 0 in
          for i = !start to min (!start + 59) (n - 1) do mx := max !mx values.(i) done;
          buckets := fold !buckets !mx;
          start := !start + 60
        done;
        let sorted = Array.copy values in
        Array.sort compare sorted;
        let rank p = sorted.(((p * n) + 99) / 100 - 1) in
        result := [ !slow; !peak; !buckets; rank 50; rank 95; rank 99; sorted.(n - 1); (!total * 1000 / n) land m ]);
      check = (fun () -> fold_all !result);
      phases = (fun () -> None) } )

let nn_in = 64 and nn_h = 64 and nn_out = 10

let infer_challenge n =
  let h = ref 0 in
  let draw k offset = let raw = rng_int k in h := fold !h raw; raw - offset in
  let vector len k offset = Array.init len (fun _ -> draw k offset) in
  let matrix rows cols k offset = Array.init rows (fun _ -> vector cols k offset) in
  let w1 = matrix nn_h nn_in 255 127 in
  let b1 = vector nn_h 2001 1000 in
  let w2 = matrix nn_h nn_h 255 127 in
  let b2 = vector nn_h 2001 1000 in
  let w3 = matrix nn_out nn_h 255 127 in
  let b3 = vector nn_out 2001 1000 in
  let x = matrix n nn_in 256 128 in
  let result = ref [] in
  ( !h, n,
    { prepare = ignore;
      run = (fun () ->
        let dense w b input =
          Array.mapi (fun j row -> let a = ref b.(j) in Array.iteri (fun k wk -> a := !a + (wk * input.(k))) row; !a) w
        in
        let relu = Array.map (fun a -> min 127 (max 0 a / 1024)) in
        let preds = ref 0 and conf = ref 0 in
        Array.iter
          (fun sample ->
            let logits = dense w3 b3 (relu (dense w2 b2 (relu (dense w1 b1 sample)))) in
            let pred = ref 0 in
            for o = 1 to nn_out - 1 do if logits.(o) > logits.(!pred) then pred := o done;
            preds := fold !preds !pred;
            conf := (!conf + logits.(!pred) + 4194304) land m)
          x;
        result := [ !preds; !conf ]);
      check = (fun () -> fold_all !result);
      phases = (fun () -> None) } )

let emb_d = 64 and emb_q = 8 and emb_k = 10

let embed_challenge n =
  let h = ref 0 in
  let draw count = Array.init count (fun _ -> Array.init emb_d (fun _ -> let raw = rng_int 256 in h := fold !h raw; raw - 128)) in
  let docs = draw n in
  let queries = draw emb_q in
  let result = ref [] in
  ( !h, n * emb_q,
    { prepare = ignore;
      run = (fun () ->
        let out = ref [] in
        Array.iter
          (fun q ->
            let scores = Array.map (fun d -> let s = ref 0 in for k = 0 to emb_d - 1 do s := !s + (d.(k) * q.(k)) done; !s) docs in
            let order = Array.init n Fun.id in
            Array.sort (fun a b -> if scores.(a) <> scores.(b) then compare scores.(b) scores.(a) else compare a b) order;
            for r = 0 to emb_k - 1 do out := (scores.(order.(r)) + 2097152) :: order.(r) :: !out done)
          queries;
        result := List.rev !out);
      check = (fun () -> fold_all !result);
      phases = (fun () -> None) } )

let pixel_challenge n =
  let rgb = Array.make (n * n * 3) 0 and h = ref 0 in
  for y = 0 to n - 1 do
    for x = 0 to n - 1 do
      let p = ((y * n) + x) * 3 in
      let r = (x + y + rng_int 64) mod 256 in
      let g = ((2 * x) + rng_int 64) mod 256 in
      let b = ((2 * y) + rng_int 64) mod 256 in
      rgb.(p) <- r; rgb.(p + 1) <- g; rgb.(p + 2) <- b;
      h := fold (fold (fold !h r) g) b
    done
  done;
  let result = ref [] and phases = ref [] in
  ( !h, n * n,
    { prepare = ignore;
      run = (fun () ->
        let t = ref (now_ns ()) and ph = ref [] in
        let lap () = let now = now_ns () in ph := (now - !t) :: !ph; t := now in
        let cl v = if v < 0 then 0 else if v >= n then n - 1 else v in
        let gray = Array.init (n * n) (fun i -> ((77 * rgb.(i * 3)) + (150 * rgb.((i * 3) + 1)) + (29 * rgb.((i * 3) + 2))) / 256) in
        lap ();
        let blur = Array.make (n * n) 0 in
        for y = 0 to n - 1 do
          let ru = cl (y - 1) * n and r0 = y * n and rd = cl (y + 1) * n in
          for x = 0 to n - 1 do
            let xl = cl (x - 1) and xr = cl (x + 1) in
            blur.(r0 + x) <-
              (gray.(ru + xl) + (2 * gray.(ru + x)) + gray.(ru + xr) + (2 * gray.(r0 + xl)) + (4 * gray.(r0 + x)) + (2 * gray.(r0 + xr))
               + gray.(rd + xl) + (2 * gray.(rd + x)) + gray.(rd + xr)) / 16
          done
        done;
        lap ();
        let mag = Array.make (n * n) 0 in
        for y = 0 to n - 1 do
          let ru = cl (y - 1) * n and r0 = y * n and rd = cl (y + 1) * n in
          for x = 0 to n - 1 do
            let xl = cl (x - 1) and xr = cl (x + 1) in
            let gx = blur.(ru + xr) + (2 * blur.(r0 + xr)) + blur.(rd + xr) - (blur.(ru + xl) + (2 * blur.(r0 + xl)) + blur.(rd + xl)) in
            let gy = blur.(rd + xl) + (2 * blur.(rd + x)) + blur.(rd + xr) - (blur.(ru + xl) + (2 * blur.(ru + x)) + blur.(ru + xr)) in
            mag.(r0 + x) <- min 255 (abs gx + abs gy)
          done
        done;
        lap ();
        let hist = Array.make 256 0 and edges = ref 0 in
        Array.iter (fun v -> hist.(v) <- hist.(v) + 1; if v >= 128 then incr edges) mag;
        lap ();
        result := Array.to_list hist @ [ !edges ];
        phases := List.rev !ph);
      check = (fun () -> fold_all !result);
      phases = (fun () -> Some !phases) } )

let () =
  emit {|{"e":"hello","lang":"ocaml"}|};
  try
    let name = Sys.argv.(1) and size = int_of_string Sys.argv.(2) and seed = int_of_string Sys.argv.(3) in
    let warmup = int_of_string Sys.argv.(4) and runs = int_of_string Sys.argv.(5) in
    rng_seed seed;
    let g0 = now_ns () in
    let hash, ops, c =
      match name with
      | "sort" -> sort_challenge size
      | "json" -> json_challenge size
      | "strings" -> strings_challenge size
      | "sieve" -> sieve_challenge size
      | "records" -> records_challenge size
      | "search" -> search_challenge size
      | "csv" -> csv_challenge size
      | "metrics" -> metrics_challenge size
      | "infer" -> infer_challenge size
      | "embed" -> embed_challenge size
      | "pixel" -> pixel_challenge size
      | other -> failwith ("unknown challenge: " ^ other)
    in
    emit (Printf.sprintf {|{"e":"ready","genNs":%d,"input":"%s","ops":%d}|} (now_ns () - g0) (hex8 hash) ops);
    for i = 0 to warmup + runs - 1 do
      c.prepare ();
      let t0 = now_ns () in
      c.run ();
      let ns = now_ns () - t0 in
      let warm = i < warmup in
      let ph = match c.phases () with
        | Some p -> Printf.sprintf {|,"phases":[%s]|} (String.concat "," (List.map string_of_int p))
        | None -> "" in
      emit (Printf.sprintf {|{"e":"%s","i":%d,"ns":%d,"check":"%s"%s}|} (if warm then "warmup" else "run") (if warm then i else i - warmup) ns (hex8 (c.check ())) ph)
    done;
    emit {|{"e":"done"}|}
  with e ->
    emit (Printf.sprintf {|{"e":"error","msg":%s}|} (Yojson.Safe.to_string (`String (Printexc.to_string e))));
    exit 1
