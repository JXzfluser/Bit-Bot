#define _POSIX_C_SOURCE 200809L

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "moonbit.h"

static void write_utf16_as_utf8(FILE *fp, const uint16_t *units, int32_t n) {
  for (int32_t i = 0; i < n; i++) {
    uint32_t cp = units[i];
    if (cp >= 0xD800 && cp <= 0xDBFF && i + 1 < n) {
      uint32_t lo = units[i + 1];
      if (lo >= 0xDC00 && lo <= 0xDFFF) {
        cp = 0x10000u + (((cp - 0xD800u) << 10) | (lo - 0xDC00u));
        i++;
      }
    }
    if (cp < 0x80u) {
      fputc((int)cp, fp);
    } else if (cp < 0x800u) {
      fputc((int)(0xC0u | (cp >> 6)), fp);
      fputc((int)(0x80u | (cp & 0x3Fu)), fp);
    } else if (cp < 0x10000u) {
      fputc((int)(0xE0u | (cp >> 12)), fp);
      fputc((int)(0x80u | ((cp >> 6) & 0x3Fu)), fp);
      fputc((int)(0x80u | (cp & 0x3Fu)), fp);
    } else {
      fputc((int)(0xF0u | (cp >> 18)), fp);
      fputc((int)(0x80u | ((cp >> 12) & 0x3Fu)), fp);
      fputc((int)(0x80u | ((cp >> 6) & 0x3Fu)), fp);
      fputc((int)(0x80u | (cp & 0x3Fu)), fp);
    }
  }
}

static moonbit_string_t utf8_to_moonbit(const char *bytes, size_t len) {
  size_t i = 0;
  int32_t count = 0;
  while (i < len) {
    unsigned char c = (unsigned char)bytes[i];
    if (c < 0x80u) {
      i += 1;
      count += 1;
    } else if ((c & 0xE0u) == 0xC0u && i + 1 < len) {
      i += 2;
      count += 1;
    } else if ((c & 0xF0u) == 0xE0u && i + 2 < len) {
      i += 3;
      count += 1;
    } else if ((c & 0xF8u) == 0xF0u && i + 3 < len) {
      i += 4;
      count += 2;
    } else {
      i += 1;
      count += 1;
    }
  }
  moonbit_string_t out = moonbit_make_string(count, 0);
  i = 0;
  int32_t j = 0;
  while (i < len) {
    unsigned char c = (unsigned char)bytes[i];
    uint32_t cp;
    if (c < 0x80u) {
      cp = c;
      i += 1;
    } else if ((c & 0xE0u) == 0xC0u && i + 1 < len) {
      cp = ((uint32_t)(c & 0x1Fu) << 6) | (uint32_t)(bytes[i + 1] & 0x3F);
      i += 2;
    } else if ((c & 0xF0u) == 0xE0u && i + 2 < len) {
      cp = ((uint32_t)(c & 0x0Fu) << 12) |
        ((uint32_t)(bytes[i + 1] & 0x3F) << 6) |
        (uint32_t)(bytes[i + 2] & 0x3F);
      i += 3;
    } else if ((c & 0xF8u) == 0xF0u && i + 3 < len) {
      cp = ((uint32_t)(c & 0x07u) << 18) |
        ((uint32_t)(bytes[i + 1] & 0x3F) << 12) |
        ((uint32_t)(bytes[i + 2] & 0x3F) << 6) |
        (uint32_t)(bytes[i + 3] & 0x3F);
      i += 4;
    } else {
      cp = c;
      i += 1;
    }
    if (cp < 0x10000u) {
      out[j++] = (uint16_t)cp;
    } else {
      cp -= 0x10000u;
      out[j++] = (uint16_t)(0xD800u + (cp >> 10));
      out[j++] = (uint16_t)(0xDC00u + (cp & 0x3FFu));
    }
  }
  return out;
}

static moonbit_string_t ascii_literal(const char *text) {
  return utf8_to_moonbit(text, strlen(text));
}

void bitbot_ffi_trace(moonbit_string_t line) {
  int32_t n = line == NULL ? 0 : Moonbit_array_length(line);
  fputs("BITBOT_LOOP ", stderr);
  if (n > 0) {
    write_utf16_as_utf8(stderr, line, n);
  }
  fputc('\n', stderr);
  fflush(stderr);
}

moonbit_string_t bitbot_ffi_exchange(moonbit_string_t request) {
  int32_t n = request == NULL ? 0 : Moonbit_array_length(request);
  fputs("BITBOT_FFI ", stdout);
  if (n > 0) {
    write_utf16_as_utf8(stdout, request, n);
  }
  fputc('\n', stdout);
  fflush(stdout);

  char *line = NULL;
  size_t cap = 0;
  ssize_t got = getline(&line, &cap, stdin);
  if (got < 0) {
    free(line);
    return ascii_literal(
      "{\"content\":\"\",\"calls\":[],\"output\":\"\",\"verdict\":\"deny\",\"error\":\"stdin\"}"
    );
  }
  while (got > 0 && (line[got - 1] == '\n' || line[got - 1] == '\r')) {
    line[--got] = '\0';
  }
  moonbit_string_t out = utf8_to_moonbit(line, (size_t)got);
  free(line);
  return out;
}

/* ---- T1-07 常驻内核：一行请求进，一行响应出 ---------------------------- */

/* 读一条请求行。返回空串有两种含义 —— 「这一行本来就是空的」和「对端已经关掉了
 * stdin」；调用方用 bitbot_ffi_stdin_eof 区分，所以不必往内容里塞哨兵字符。 */
moonbit_string_t bitbot_ffi_serve_read(void) {
  char *line = NULL;
  size_t cap = 0;
  ssize_t got = getline(&line, &cap, stdin);
  if (got < 0) {
    free(line);
    return moonbit_make_string(0, 0);
  }
  while (got > 0 && (line[got - 1] == '\n' || line[got - 1] == '\r')) {
    line[--got] = '\0';
  }
  moonbit_string_t out = utf8_to_moonbit(line, (size_t)got);
  free(line);
  return out;
}

int bitbot_ffi_stdin_eof(void) { return feof(stdin) ? 1 : 0; }

/* MoonBit 的 println 落到 C 的 stdout，不保证行缓冲；Host 在等这一行，所以每一
 * 条响应之后必须自己冲刷。 */
void bitbot_ffi_flush_stdout(void) { fflush(stdout); }
