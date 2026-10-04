{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE ExistentialQuantification #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE OverloadedStrings #-}

module Main (main) where

import Control.DeepSeq (NFData, deepseq, force)
import Control.Exception (SomeException, evaluate, try)
import Control.Monad (forM_, when)
import Control.Monad.ST (runST)
import Data.Aeson (FromJSON (..), ToJSON (..), (.:))
import qualified Data.Aeson as A
import qualified Data.Aeson.Encoding as AE
import Data.Bits (shiftL, shiftR, xor, (.&.))
import qualified Data.ByteString as BS
import qualified Data.ByteString.Builder as B
import qualified Data.ByteString.Char8 as BC
import qualified Data.ByteString.Lazy as BL
import qualified Data.IntMap.Strict as IM
import Data.List (foldl', intersperse, sortBy)
import qualified Data.Map.Strict as Map
import Data.Ord (Down (..), comparing)
import qualified Data.Text as T
import qualified Data.Vector as V
import qualified Data.Vector.Algorithms.Intro as Intro
import qualified Data.Vector.Unboxed as U
import qualified Data.Vector.Unboxed.Mutable as UM
import Data.Word (Word32, Word64, Word8)
import GHC.Clock (getMonotonicTimeNSec)
import GHC.Generics (Generic)
import System.Environment (getArgs)
import System.Exit (exitWith, ExitCode (..))
import System.IO (BufferMode (..), hFlush, hSetBuffering, stdout)
import Text.Printf (printf)
import Text.Regex.TDFA (Regex, defaultCompOpt, defaultExecOpt, match)
import Text.Regex.TDFA.ByteString (compile)

emit :: String -> IO ()
emit s = putStrLn s >> hFlush stdout

hex8 :: Word32 -> String
hex8 = printf "%08x"

countries, levels, resources, regions :: V.Vector BS.ByteString
countries = V.fromList ["US", "GB", "DE", "FR", "JP", "BR", "IN", "CN", "CA", "AU", "NO", "SE", "ZA", "NG", "MX", "ES", "IT", "KR", "NL", "PL"]
levels = V.fromList ["INFO", "WARN", "ERROR", "DEBUG"]
resources = V.fromList ["users", "orders", "items", "auth", "search"]
regions = V.fromList ["NA", "EMEA", "APAC", "LATAM", "ANZ", "MEA", "NORDICS", "DACH"]

statuses :: U.Vector Int
statuses = U.fromList [200, 200, 200, 201, 404, 500]

draws :: Word64 -> [Word32]
draws seed = tail (iterate step s0)
  where
    s0 = let s = fromIntegral seed :: Word32 in if s == 0 then 0x9e3779b9 else s
    step x0 = let x1 = x0 `xor` (x0 `shiftL` 13); x2 = x1 `xor` (x1 `shiftR` 17) in x2 `xor` (x2 `shiftL` 5)

modN :: Word32 -> Int -> Int
modN d n = fromIntegral (d `mod` fromIntegral n)

chunks :: Int -> [a] -> [[a]]
chunks k xs = let (a, b) = splitAt k xs in a : chunks k b

fold :: Word32 -> Word64 -> Word32
fold h v = h * 31 + fromIntegral v

foldAll :: [Word64] -> Word32
foldAll = foldl' fold 0

fnv1a :: BS.ByteString -> Word32
fnv1a = BS.foldl' (\h b -> (h `xor` fromIntegral b) * 0x01000193) 0x811c9dc5

int :: Int -> B.Builder
int = B.intDec

data Challenge = forall o. NFData o => Challenge
  { prepare :: IO (),
    runOnce :: IO (o, Maybe [Word64]),
    checkOf :: o -> Word32
  }

sortChallenge :: Int -> Word64 -> IO (Word32, Int, Challenge)
sortChallenge n seed = do
  let !dat = U.fromListN n [fromIntegral (d .&. 0x7fffffff) :: Int | d <- take n (draws seed)]
      hash = U.foldl' (\h v -> fold h (fromIntegral v)) 0 dat
  pure (hash, n, Challenge (pure ()) (pure (U.modify Intro.sort dat, Nothing)) (U.foldl' (\h v -> fold h (fromIntegral v)) 0))

data JRec = JRec {jId :: !Int, jName :: !T.Text, jCountry :: !T.Text, jScore :: !Int, jActive :: !Bool, jTags :: ![T.Text]}

instance FromJSON JRec where
  parseJSON = A.withObject "record" $ \o -> JRec <$> o .: "id" <*> o .: "name" <*> o .: "country" <*> o .: "score" <*> o .: "active" <*> o .: "tags"

data JOut = JOut !T.Text !Int !T.Text !Int !Int

instance ToJSON JOut where
  toJSON (JOut c i n s t) = A.object ["country" A..= c, "id" A..= i, "name" A..= n, "score2" A..= s, "tagCount" A..= t]
  toEncoding (JOut c i n s t) = AE.pairs ("country" A..= c <> "id" A..= i <> "name" A..= n <> "score2" A..= s <> "tagCount" A..= t)

jsonChallenge :: Int -> Word64 -> IO (Word32, Int, Challenge)
jsonChallenge n seed = do
  let rec i [c, a, s, act, t1, t2] =
        "{\"id\":" <> int i <> ",\"name\":\"user_" <> int i <> "\",\"country\":\"" <> B.byteString (countries V.! modN c 20)
          <> "\",\"age\":" <> int (10 + modN a 80) <> ",\"score\":" <> int (modN s 1000)
          <> ",\"active\":" <> (if act .&. 1 == 1 then "true" else "false")
          <> ",\"tags\":[\"t" <> int (modN t1 10) <> "\",\"t" <> int (modN t2 10) <> "\"]}"
      rec _ _ = mempty
      parts = zipWith rec [0 .. n - 1] (chunks 6 (draws seed))
      !text = BL.toStrict (B.toLazyByteString ("[" <> mconcat (intersperseB "," parts) <> "]"))
      run = do
        let records = either error id (A.eitherDecodeStrict' text) :: [JRec]
            out = [JOut (jCountry r) (jId r) (T.toUpper (jName r)) (jScore r * 2) (length (jTags r)) | r <- records, jActive r, jScore r >= 500]
        pure (BL.toStrict (A.encode out), Nothing)
  pure (fnv1a text, n, Challenge (pure ()) run fnv1a)
  where
    intersperseB sep = go where go (x : y : r) = x : sep : go (y : r); go xs = xs

stringsChallenge :: Int -> Word64 -> IO (Word32, Int, Challenge)
stringsChallenge n seed = do
  let line i [l, u, r, d, s, la] =
        "ts=" <> int (1700000000 + i) <> " level=" <> B.byteString (levels V.! modN l 4) <> " user=u" <> int (modN u 1000)
          <> " path=/api/" <> B.byteString (resources V.! modN r 5) <> "/" <> int (modN d 10000)
          <> " status=" <> int (statuses U.! modN s 6) <> " latency=" <> int (modN la 2000) <> "ms"
      line _ _ = mempty
      ls = zipWith line [0 .. n - 1] (chunks 6 (draws seed))
      !text = BL.toStrict (B.toLazyByteString (mconcat (zipWith (<>) ls (replicate (n - 1) "\n" ++ [mempty]))))
      run = do
        let re = either error id (compile defaultCompOpt defaultExecOpt "status=([0-9]{3}) latency=([0-9]+)ms") :: Regex
            step (!l, !s5, !e, !lat, !t) ln =
              let (s5', lat') = case match re ln :: (BS.ByteString, BS.ByteString, BS.ByteString, [BS.ByteString]) of
                    (_, _, _, [st, la]) -> (if readInt st >= 500 then s5 + 1 else s5, lat + readInt la)
                    _ -> (s5, lat)
                  e' = if "level=ERROR" `BS.isInfixOf` ln then e + 1 else e
               in (l + 1, s5', e', lat', t + length (BC.split ' ' ln))
            (l, s5, e, lat, t) = foldl' step (0 :: Int, 0 :: Int, 0 :: Int, 0 :: Int, 0 :: Int) (BC.split '\n' text)
        pure (map fromIntegral [l, s5, e, lat .&. 0xffffffff, t] :: [Word64], Nothing)
  pure (fnv1a text, n, Challenge (pure ()) run foldAll)
  where
    readInt = maybe 0 fst . BC.readInt

sieveChallenge :: Int -> Word64 -> IO (Word32, Int, Challenge)
sieveChallenge n _ = pure (fromIntegral n, n, Challenge (pure ()) (pure (sieve n, Nothing)) foldAll)

sieve :: Int -> [Word64]
sieve n = runST $ do
  composite <- UM.replicate (n + 1) False
  let outer i
        | i * i > n = pure ()
        | otherwise = do
            c <- UM.unsafeRead composite i
            when (not c) $ let mark j = when (j <= n) (UM.unsafeWrite composite j True >> mark (j + i)) in mark (i * i)
            outer (i + 1)
  outer 2
  frozen <- U.unsafeFreeze composite
  let (!count, !total) = U.ifoldl' (\(!c, !s) k isComposite -> if k >= 2 && not isComposite then (c + 1, s + k) else (c, s)) (0 :: Int, 0 :: Int) frozen
  pure [fromIntegral count, fromIntegral (total .&. 0xffffffff)]

data Rec = Rec {rId :: !Int, rName :: !BS.ByteString, rCountry :: !BS.ByteString, rAge :: !Int, rScore :: !Int, rCreated :: !Int}
  deriving (Generic, NFData)

recordsChallenge :: Int -> Word64 -> IO (Word32, Int, Challenge)
recordsChallenge n seed = do
  let mk i [c, a, s, cr] = let ci = modN c 20 in (ci, Rec i (BC.pack ("user_" ++ show i)) (countries V.! ci) (10 + modN a 80) (modN s 1000) (1700000000 + modN cr 31536000))
      mk _ _ = error "unreachable"
      built = zipWith mk [0 .. n - 1] (chunks 4 (draws seed))
      !recs = force (V.fromListN n (map snd built))
      hash = foldl' (\h (ci, r) -> foldl' fold h (map fromIntegral [ci, rAge r, rScore r, rCreated r])) 0 built
      cutoff = 1700000000 + 15768000
      run = do
        let groups =
              V.foldl'
                (\m r -> if rAge r >= 18 && rScore r >= 100 && rCreated r >= cutoff then Map.insertWith combine (rCountry r) (1, rScore r, rScore r, rAge r) m else m)
                Map.empty
                recs
            combine (!c1, !s1, !m1, !a1) (!c2, !s2, !m2, !a2) = (c1 + c2, s1 + s2, max m1 m2, a1 + a2)
            sorted = sortBy (comparing (\(c, (_, s, _, _)) -> (Down s, c))) (Map.toList groups)
        pure (sorted, Nothing)
      check = foldl' (\h (c, (cnt, s, mx, a)) -> foldl' fold (fold h (fromIntegral (fnv1a c))) (map fromIntegral [cnt, s .&. 0xffffffff, mx, a .&. 0xffffffff])) 0
  hash `seq` pure (hash, n, Challenge (pure ()) run check)

searchChallenge :: Int -> Word64 -> IO (Word32, Int, Challenge)
searchChallenge n seed = do
  let (kd, qd) = splitAt n (take (2 * n) (draws seed))
      !keys = U.fromListN n [fromIntegral (d .&. 0x7fffffff) :: Int | d <- kd]
      !queries = U.fromListN n [if even i then keys U.! modN d n else fromIntegral (d .&. 0x7fffffff) | (i, d) <- zip [0 :: Int ..] qd]
      hash = U.foldl' (\h v -> fold h (fromIntegral v)) (U.foldl' (\h v -> fold h (fromIntegral v)) 0 keys) queries
      run = do
        t0 <- getMonotonicTimeNSec
        index <- evaluate (U.ifoldl' (\m i k -> IM.insert k i m) IM.empty keys)
        t1 <- getMonotonicTimeNSec
        let (!hits, !total) = U.foldl' (\(!h, !s) q -> maybe (h, s) (\v -> (h + 1, s + v)) (IM.lookup q index)) (0 :: Int, 0 :: Int) queries
        _ <- evaluate hits
        t2 <- getMonotonicTimeNSec
        sorted <- evaluate (U.modify Intro.sort keys)
        t3 <- getMonotonicTimeNSec
        let size = U.length sorted
            lowerBound q = go 0 size where go lo hi | lo < hi = let mid = (lo + hi) `div` 2 in if U.unsafeIndex sorted mid < q then go (mid + 1) hi else go lo mid | otherwise = lo
            !binHits = U.foldl' (\acc q -> let p = lowerBound q in if p < size && U.unsafeIndex sorted p == q then acc + 1 else acc) (0 :: Int) queries
        _ <- evaluate binHits
        t4 <- getMonotonicTimeNSec
        pure (map fromIntegral [hits, total .&. 0xffffffff, binHits] :: [Word64], Just [t1 - t0, t2 - t1, t3 - t2, t4 - t3])
  hash `seq` pure (hash, 2 * n, Challenge (pure ()) run foldAll)

pad2 :: Int -> B.Builder
pad2 v = if v < 10 then "0" <> int v else int v

csvChallenge :: Int -> Word64 -> IO (Word32, Int, Challenge)
csvChallenge n seed = do
  let row i [mo, d, r, s, q, p, dc] =
        int i <> ",2026-" <> pad2 (1 + modN mo 12) <> "-" <> pad2 (1 + modN d 28) <> "," <> B.byteString (regions V.! modN r 8)
          <> ",SKU-" <> int (modN s 1000) <> "," <> int (1 + modN q 20) <> "," <> int (99 + modN p 99901) <> "," <> int (5 * modN dc 5)
      row _ _ = mempty
      rows = zipWith row [0 .. n - 1] (chunks 7 (draws seed))
      !text = BL.toStrict (B.toLazyByteString (mconcat (intersperse "\n" ("order_id,date,region,sku,qty,unit_price_cents,discount_pct" : rows))))
      run = do
        let step m line = case BC.split ',' line of
              [_, date, region, _, qtyS, priceS, discountS] ->
                let qty = readInt qtyS
                    revenue = qty * readInt priceS * (100 - readInt discountS) `div` 100
                 in Map.insertWith combine (region, readInt (BS.take 2 (BS.drop 5 date))) (1, qty, revenue) m
              _ -> m
            combine (!o1, !u1, !r1) (!o2, !u2, !r2) = (o1 + o2, u1 + u2, r1 + r2)
            groups = foldl' step Map.empty (drop 1 (BC.split '\n' text))
            report =
              "region,month,orders,units,revenue_cents"
                <> mconcat ["\n" <> B.byteString region <> ",2026-" <> pad2 month <> "," <> int o <> "," <> int u <> "," <> int r | ((region, month), (o, u, r)) <- Map.toAscList groups]
        pure (BL.toStrict (B.toLazyByteString report), Nothing)
  pure (fnv1a text, n, Challenge (pure ()) run fnv1a)
  where
    readInt = maybe 0 fst . BC.readInt

metricsChallenge :: Int -> Word64 -> IO (Word32, Int, Challenge)
metricsChallenge n seed = do
  let samples :: Int -> [Word32] -> [Int]
      samples 0 _ = []
      samples k (a : r : rest)
        | modN r 100 < 3, (e : rest') <- rest = 20 + modN a 80 + 200 + modN e 800 : samples (k - 1) rest'
        | otherwise = 20 + modN a 80 : samples (k - 1) rest
      samples _ _ = []
      !values = U.fromListN n (samples n (draws seed))
      hash = U.foldl' (\h v -> fold h (fromIntegral v)) 0 values
      run = do
        let step (!s, !p, !w) i v =
              let w' = w + v - (if i >= 60 then U.unsafeIndex values (i - 60) else 0)
               in if i >= 59 then (if w' > 7200 then s + 1 else s, max p w', w') else (s, p, w')
            (slow, peak, _) = U.ifoldl' step (0 :: Int, 0 :: Int, 0 :: Int) values
            buckets = foldl' (\h s -> fold h (fromIntegral (U.maximum (U.slice s (min 60 (n - s)) values)))) 0 [0, 60 .. n - 1]
            sorted = U.modify Intro.sort values
            rank p = sorted U.! ((p * n + 99) `div` 100 - 1)
            meanMilli = U.sum values * 1000 `div` n
        pure (map fromIntegral [slow, peak, fromIntegral buckets, rank 50, rank 95, rank 99, U.last sorted, meanMilli .&. 0xffffffff] :: [Word64], Nothing)
  hash `seq` pure (hash, n, Challenge (pure ()) run foldAll)

nnIn, nnH, nnOut, embD, embQ, embK :: Int
nnIn = 64
nnH = 64
nnOut = 10
embD = 64
embQ = 8
embK = 10

inferChallenge :: Int -> Word64 -> IO (Word32, Int, Challenge)
inferChallenge n seed = do
  let groups = [(nnH * nnIn, 255, 127), (nnH, 2001, 1000), (nnH * nnH, 255, 127), (nnH, 2001, 1000), (nnOut * nnH, 255, 127), (nnOut, 2001, 1000), (n * nnIn, 256, 128)]
      split [] _ = []
      split ((count, k, _) : rest) ds = let (a, b) = splitAt count ds in map (`modN` k) a : split rest b
      raws = split groups (draws seed)
      hash = foldl' (foldl' (\h r -> fold h (fromIntegral r))) 0 raws
  [w1, b1, w2, b2, w3, b3, x] <- evaluate (force (zipWith (\(count, _, off) g -> U.fromListN count (map (subtract off) g)) groups raws))
  let run = do
        let layer w b inLen input = U.generate (U.length b) (\j -> b U.! j + U.sum (U.zipWith (*) (U.slice (j * inLen) inLen w) input))
            relu = U.map (\a -> min 127 (max 0 a `div` 1024))
            sample (!preds, !conf) s =
              let h1 = relu (layer w1 b1 nnIn (U.slice (s * nnIn) nnIn x))
                  h2 = relu (layer w2 b2 nnH h1)
                  logits = layer w3 b3 nnH h2
                  pred = U.maxIndex logits
               in (fold preds (fromIntegral pred), conf + fromIntegral (logits U.! pred + 4194304))
            (preds, conf) = foldl' sample (0 :: Word32, 0 :: Word32) [0 .. n - 1]
        pure ([fromIntegral preds, fromIntegral conf] :: [Word64], Nothing)
  hash `seq` pure (hash, n, Challenge (pure ()) run foldAll)

embedChallenge :: Int -> Word64 -> IO (Word32, Int, Challenge)
embedChallenge n seed = do
  let (dd, qd) = splitAt (n * embD) (map (`modN` 256) (take ((n + embQ) * embD) (draws seed)))
      hash = foldl' (\h r -> fold h (fromIntegral r)) 0 (dd ++ qd)
      !docs = U.fromListN (n * embD) (map (subtract 128) dd)
      !queries = U.fromListN (embQ * embD) (map (subtract 128) qd)
      run = do
        let topK q =
              let qv = U.slice (q * embD) embD queries
                  scores = U.generate n (\d -> U.sum (U.zipWith (*) (U.slice (d * embD) embD docs) qv))
                  ranked = U.modify (Intro.sortBy (comparing (Down . (scores U.!)) <> compare)) (U.enumFromN 0 n)
               in concat [[fromIntegral i, fromIntegral (scores U.! i + 2097152)] | i <- U.toList (U.take embK ranked)]
        pure (concatMap topK [0 .. embQ - 1] :: [Word64], Nothing)
  hash `seq` pure (hash, n * embQ, Challenge (pure ()) run foldAll)

pixelChallenge :: Int -> Word64 -> IO (Word32, Int, Challenge)
pixelChallenge n seed = do
  let px (y, x) [a, b, c] = [(x + y + modN a 64) `mod` 256, (2 * x + modN b 64) `mod` 256, (2 * y + modN c 64) `mod` 256]
      px _ _ = []
      coords = [(y, x) | y <- [0 .. n - 1], x <- [0 .. n - 1]]
      !rgb = U.fromListN (n * n * 3) (map fromIntegral (concat (zipWith px coords (chunks 3 (draws seed))))) :: U.Vector Word8
      hash = U.foldl' (\h v -> fold h (fromIntegral v)) 0 rgb
      run = do
        let cl v = max 0 (min (n - 1) v)
            at img i = fromIntegral (U.unsafeIndex img i) :: Int
            neighbourhood f = U.generate (n * n) $ \i ->
              let (y, x) = i `divMod` n
               in fromIntegral (f (cl (y - 1) * n) (y * n) (cl (y + 1) * n) (cl (x - 1)) x (cl (x + 1))) :: Word8
        t0 <- getMonotonicTimeNSec
        gray <- evaluate (U.generate (n * n) (\i -> fromIntegral ((77 * at rgb (3 * i) + 150 * at rgb (3 * i + 1) + 29 * at rgb (3 * i + 2)) `div` 256)) :: U.Vector Word8)
        t1 <- getMonotonicTimeNSec
        blur <- evaluate $ neighbourhood $ \ru r0 rd xl x xr ->
          let g = at gray
           in (g (ru + xl) + 2 * g (ru + x) + g (ru + xr) + 2 * g (r0 + xl) + 4 * g (r0 + x) + 2 * g (r0 + xr) + g (rd + xl) + 2 * g (rd + x) + g (rd + xr)) `div` 16
        t2 <- getMonotonicTimeNSec
        mag <- evaluate $ neighbourhood $ \ru r0 rd xl x xr ->
          let b = at blur
              gx = b (ru + xr) + 2 * b (r0 + xr) + b (rd + xr) - (b (ru + xl) + 2 * b (r0 + xl) + b (rd + xl))
              gy = b (rd + xl) + 2 * b (rd + x) + b (rd + xr) - (b (ru + xl) + 2 * b (ru + x) + b (ru + xr))
           in min 255 (abs gx + abs gy)
        t3 <- getMonotonicTimeNSec
        hist <- evaluate (U.accumulate (+) (U.replicate 256 (0 :: Int)) (U.map (\m -> (fromIntegral m, 1)) mag))
        edges <- evaluate (U.length (U.filter (>= 128) mag))
        t4 <- getMonotonicTimeNSec
        pure (map fromIntegral (U.toList hist ++ [edges]) :: [Word64], Just [t1 - t0, t2 - t1, t3 - t2, t4 - t3])
  hash `seq` pure (hash, n * n, Challenge (pure ()) run foldAll)

main :: IO ()
main = do
  hSetBuffering stdout LineBuffering
  emit "{\"e\":\"hello\",\"lang\":\"haskell\"}"
  result <- try $ do
    args <- getArgs
    case args of
      (name : sizeS : seedS : warmS : runsS : _) -> do
        let size = read sizeS; seed = read seedS; warmup = read warmS; runs = read runsS :: Int
        mk <- case name of
          "sort" -> pure sortChallenge
          "json" -> pure jsonChallenge
          "strings" -> pure stringsChallenge
          "sieve" -> pure sieveChallenge
          "records" -> pure recordsChallenge
          "search" -> pure searchChallenge
          "csv" -> pure csvChallenge
          "metrics" -> pure metricsChallenge
          "infer" -> pure inferChallenge
          "embed" -> pure embedChallenge
          "pixel" -> pure pixelChallenge
          _ -> ioError (userError ("unknown challenge: " ++ name))
        g0 <- getMonotonicTimeNSec
        (hash, ops, Challenge prep runIt check) <- mk size seed
        _ <- evaluate hash
        g1 <- getMonotonicTimeNSec
        emit (printf "{\"e\":\"ready\",\"genNs\":%d,\"input\":\"%s\",\"ops\":%d}" (g1 - g0) (hex8 hash) ops)
        forM_ [0 .. warmup + runs - 1] $ \i -> do
          prep
          t0 <- getMonotonicTimeNSec
          (out, phases) <- runIt
          out `deepseq` pure ()
          t1 <- getMonotonicTimeNSec
          let warm = i < warmup
              ph = maybe "" (\p -> ",\"phases\":[" ++ concatMap id (sepBy "," (map show p)) ++ "]") phases
          emit (printf "{\"e\":\"%s\",\"i\":%d,\"ns\":%d,\"check\":\"%s\"%s}" (if warm then "warmup" else "run" :: String) (if warm then i else i - warmup) (t1 - t0) (hex8 (check out)) ph)
        emit "{\"e\":\"done\"}"
      _ -> ioError (userError "usage: harness <challenge> <size> <seed> <warmup> <runs>")
  case result of
    Right () -> pure ()
    Left e -> do
      emit ("{\"e\":\"error\",\"msg\":" ++ BC.unpack (BL.toStrict (A.encode (show (e :: SomeException)))) ++ "}")
      exitWith (ExitFailure 1)
  where
    sepBy s (x : y : r) = x : s : sepBy s (y : r)
    sepBy _ xs = xs
