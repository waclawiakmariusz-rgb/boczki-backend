-- ============================================================
-- BOCZKI BACKEND - Schemat bazy danych
-- Wygenerowano na podstawie multiplik.xlsx
-- ============================================================
-- UWAGA: Tabela `Licencje` jest systemowa - NIE jest kasowana!
-- ============================================================

SET FOREIGN_KEY_CHECKS = 0;
SET NAMES utf8mb4;

-- ============================================================
-- 1. KASOWANIE STARYCH TABEL
-- ============================================================

DROP TABLE IF EXISTS `Archiwum`;
DROP TABLE IF EXISTS `Czerwiec`;
DROP TABLE IF EXISTS `Grudzień`;
DROP TABLE IF EXISTS `Klienci`;
DROP TABLE IF EXISTS `Koszty`;
DROP TABLE IF EXISTS `Kwiecień`;
DROP TABLE IF EXISTS `Lipiec`;
DROP TABLE IF EXISTS `Listopad`;
DROP TABLE IF EXISTS `Logi`;
DROP TABLE IF EXISTS `Luty`;
DROP TABLE IF EXISTS `Magazyn`;
DROP TABLE IF EXISTS `Maj`;
DROP TABLE IF EXISTS `Marzec`;
DROP TABLE IF EXISTS `Memo`;
DROP TABLE IF EXISTS `Październik`;
DROP TABLE IF EXISTS `Platnosci`;
DROP TABLE IF EXISTS `Pracownicy`;
DROP TABLE IF EXISTS `Pracownicy_konsultacja`;
DROP TABLE IF EXISTS `Pracownicy_targety`;
DROP TABLE IF EXISTS `Rabaty`;
DROP TABLE IF EXISTS `Rabaty1`;
DROP TABLE IF EXISTS `Raport_Kategorie`;
DROP TABLE IF EXISTS `Raport_Logi`;
DROP TABLE IF EXISTS `Raport_Magazyn`;
DROP TABLE IF EXISTS `Raport_Ustawienia`;
DROP TABLE IF EXISTS `Rejestr_Oświadczeń`;
DROP TABLE IF EXISTS `Rejestr_RODO`;
DROP TABLE IF EXISTS `Retencja`;
DROP TABLE IF EXISTS `Sierpień`;
DROP TABLE IF EXISTS `Slownik`;
DROP TABLE IF EXISTS `Sprzedaz`;
DROP TABLE IF EXISTS `Styczeń`;
DROP TABLE IF EXISTS `Sugestie`;
DROP TABLE IF EXISTS `Typy_konsultacji`;
DROP TABLE IF EXISTS `Uslugi`;
DROP TABLE IF EXISTS `Ustawienia`;
DROP TABLE IF EXISTS `Użytkownicy`;
DROP TABLE IF EXISTS `Wrzesień`;
DROP TABLE IF EXISTS `Wyniki_konsultacja`;
DROP TABLE IF EXISTS `Zadatki`;

-- ============================================================
-- 2. TWORZENIE NOWYCH TABEL
-- ============================================================

CREATE TABLE `Sprzedaz` (
  `id`                  VARCHAR(50)   NOT NULL,
  `tenant_id`           VARCHAR(36)   NOT NULL,
  `data_sprzedazy`      DATETIME      NULL,
  `klient`              VARCHAR(255)  NULL,
  `zabieg`              VARCHAR(255)  NULL,
  `sprzedawca`          TEXT          NULL,
  `kwota`               DECIMAL(10,2) NULL,
  `komentarz`           TEXT          NULL,
  `szczegoly`           TEXT          NULL,
  `status`              VARCHAR(50)   NULL DEFAULT 'AKTYWNY',
  `platnosc`            VARCHAR(50)   NULL,
  `id_klienta`          VARCHAR(50)   NULL,
  `pracownik_dodajacy`  VARCHAR(100)  NULL,
  `id_zadatku`          TEXT          NULL,
  `utworzono_w`         TIMESTAMP     NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tenant` (`tenant_id`),
  KEY `idx_klient` (`id_klienta`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `Raport_Logi` (
  `id`          VARCHAR(36)   NOT NULL,
  `tenant_id`   VARCHAR(36)   NOT NULL,
  `data`        DATETIME      NULL,
  `akcja`       VARCHAR(100)  NULL,
  `produkt`     VARCHAR(255)  NULL,
  `opis`        TEXT          NULL,
  `pracownik`   VARCHAR(100)  NULL,
  `utworzono_w` TIMESTAMP     NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `Zadatki` (
  `id`          VARCHAR(50)   NOT NULL,
  `tenant_id`   VARCHAR(36)   NOT NULL,
  `id_klienta`  VARCHAR(50)   NULL,
  `data_wplaty` DATETIME      NULL,
  `klient`      VARCHAR(255)  NULL,
  `typ`         VARCHAR(50)   NULL,
  `kwota`       DECIMAL(10,2) NULL,
  `metoda`      VARCHAR(50)   NULL,
  `cel`         TEXT          NULL,
  `status`      VARCHAR(50)   NULL DEFAULT 'AKTYWNY',
  `pracownicy`  TEXT          NULL,
  `utworzono_w` TIMESTAMP     NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `Sugestie` (
  `id`           VARCHAR(36)  NOT NULL,
  `tenant_id`    VARCHAR(36)  NOT NULL,
  `matka`        VARCHAR(255) NULL,
  `dziecko`      VARCHAR(255) NULL,
  `argumentacja` TEXT         NULL,
  `kto_dodal`    VARCHAR(100) NULL,
  `utworzono_w`  TIMESTAMP    NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `Klienci` (
  `id`              VARCHAR(36)  NOT NULL,
  `tenant_id`       VARCHAR(36)  NOT NULL,
  `id_klienta`      VARCHAR(50)  NULL,
  `imie_nazwisko`   VARCHAR(255) NULL,
  `telefon`         VARCHAR(50)  NULL,
  `data_rejestracji` DATETIME    NULL,
  `zgody_rodo_reg`  VARCHAR(255) NULL,
  `notatki`         TEXT         NULL,
  `rodo`            VARCHAR(20)  NULL,
  `osw`             VARCHAR(20)  NULL,
  `utworzono_w`     TIMESTAMP    NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tenant` (`tenant_id`),
  KEY `idx_klient` (`id_klienta`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `Rejestr_Oświadczeń` (
  `id`                        VARCHAR(36)  NOT NULL,
  `tenant_id`                 VARCHAR(36)  NOT NULL,
  `id_klienta`                VARCHAR(50)  NULL,
  `data_podpisu`              DATE         NULL,
  `klient`                    VARCHAR(255) NULL,
  `zapoznanie_z_regulaminem`  VARCHAR(10)  NULL,
  `przekazano_wyciag`         VARCHAR(10)  NULL,
  `pracownik`                 VARCHAR(100) NULL,
  `link_pdf`                  TEXT         NULL,
  `utworzono_w`               TIMESTAMP    NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `Rejestr_RODO` (
  `id`               VARCHAR(36)  NOT NULL,
  `tenant_id`        VARCHAR(36)  NOT NULL,
  `lp`               INT(11)      NULL,
  `klient`           VARCHAR(255) NULL,
  `data_podpisu`     DATE         NULL,
  `wizerunek`        VARCHAR(255) NULL,
  `newsletter_sms`   VARCHAR(10)  NULL,
  `kontakt_tel`      VARCHAR(10)  NULL,
  `newsletter_email` VARCHAR(10)  NULL,
  `booksy_sms`       VARCHAR(50)  NULL,
  `email_adres`      VARCHAR(100) NULL,
  `id_klienta`       VARCHAR(50)  NULL,
  `pracownik`        VARCHAR(100) NULL,
  `link_pdf`         TEXT         NULL,
  `email_kontaktowy` VARCHAR(255) NULL,
  `utworzono_w`      TIMESTAMP    NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `Pracownicy` (
  `id`          VARCHAR(36)  NOT NULL,
  `tenant_id`   VARCHAR(36)  NOT NULL,
  `imie`        VARCHAR(100) NULL,
  `utworzono_w` TIMESTAMP    NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `Użytkownicy` (
  `id`          VARCHAR(36)  NOT NULL,
  `tenant_id`   VARCHAR(36)  NOT NULL,
  `imie_login`  VARCHAR(100) NULL,
  `haslo_pin`   VARCHAR(255) NULL,
  `rola`        VARCHAR(50)  NULL,
  `utworzono_w` TIMESTAMP    NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `Uslugi` (
  `id`          VARCHAR(36)   NOT NULL,
  `tenant_id`   VARCHAR(36)   NOT NULL,
  `kategoria`   VARCHAR(255)  NULL,
  `wariant`     VARCHAR(255)  NULL,
  `cena`        DECIMAL(10,2) NULL,
  `utworzono_w` TIMESTAMP     NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `Memo` (
  `id`            VARCHAR(36)  NOT NULL,
  `tenant_id`     VARCHAR(36)  NOT NULL,
  `id_oryginalne` VARCHAR(50)  NULL,
  `id_klienta`    VARCHAR(50)  NULL,
  `klient`        VARCHAR(255) NULL,
  `notatka`       TEXT         NULL,
  `utworzono_w`   TIMESTAMP    NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `Rabaty` (
  `id`           VARCHAR(36)   NOT NULL,
  `tenant_id`    VARCHAR(36)   NOT NULL,
  `nazwa`        VARCHAR(150)  NULL,
  `typ`          VARCHAR(50)   NULL,
  `wartosc`      DECIMAL(10,2) NULL,
  `aktywny`      VARCHAR(10)   NULL DEFAULT 'TAK',
  `data_dodania` DATETIME      NULL,
  `kto_dodal`    VARCHAR(100)  NULL,
  `utworzono_w`  TIMESTAMP     NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `Platnosci` (
  `id`               VARCHAR(50)   NOT NULL,
  `tenant_id`        VARCHAR(36)   NOT NULL,
  `data_platnosci`   DATETIME      NULL,
  `klient`           VARCHAR(255)  NULL,
  `metoda_platnosci` VARCHAR(50)   NULL,
  `kwota`            DECIMAL(10,2) NULL,
  `status`           VARCHAR(50)   NULL DEFAULT 'AKTYWNY',
  `utworzono_w`      TIMESTAMP     NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `Retencja` (
  `id`             VARCHAR(36)  NOT NULL,
  `tenant_id`      VARCHAR(36)  NOT NULL,
  `data_kontaktu`  DATETIME     NULL,
  `id_klienta`     VARCHAR(50)  NULL,
  `klient`         VARCHAR(255) NULL,
  `kategoria_filtr` VARCHAR(255) NULL,
  `status`         VARCHAR(100) NULL,
  `notatka`        TEXT         NULL,
  `pracownik`      VARCHAR(100) NULL,
  `utworzono_w`    TIMESTAMP    NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `Logi` (
  `id`             VARCHAR(36)  NOT NULL,
  `tenant_id`      VARCHAR(36)  NOT NULL,
  `data_zdarzenia` DATETIME     NULL,
  `pracownik`      VARCHAR(100) NULL,
  `akcja`          VARCHAR(100) NULL,
  `modul`          VARCHAR(100) NULL,
  `opis`           TEXT         NULL,
  `utworzono_w`    TIMESTAMP    NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `Rabaty1` (
  `id`           VARCHAR(36)   NOT NULL,
  `tenant_id`    VARCHAR(36)   NOT NULL,
  `nazwa`        VARCHAR(150)  NULL,
  `typ`          VARCHAR(50)   NULL,
  `wartosc`      DECIMAL(10,2) NULL,
  `aktywny`      VARCHAR(10)   NULL DEFAULT 'TAK',
  `data_dodania` DATETIME      NULL,
  `kto_dodal`    VARCHAR(100)  NULL,
  `utworzono_w`  TIMESTAMP     NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `Slownik` (
  `id`          VARCHAR(36)   NOT NULL,
  `tenant_id`   VARCHAR(36)   NOT NULL,
  `firma`       VARCHAR(100)  NULL,
  `model`       VARCHAR(255)  NULL,
  `cena_detal`  DECIMAL(10,2) NULL,
  `utworzono_w` TIMESTAMP     NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `Ustawienia` (
  `id`          VARCHAR(36)  NOT NULL,
  `tenant_id`   VARCHAR(36)  NOT NULL,
  `login`       VARCHAR(100) NULL,
  `haslo`       VARCHAR(255) NULL,
  `rola`        VARCHAR(50)  NULL,
  `utworzono_w` TIMESTAMP    NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `Archiwum` (
  `id`               VARCHAR(50)   NOT NULL,
  `tenant_id`        VARCHAR(36)   NOT NULL,
  `nazwa_produktu`   VARCHAR(255)  NULL,
  `typ`              VARCHAR(100)  NULL,
  `ilosc`            DECIMAL(10,2) NULL,
  `min`              DECIMAL(10,2) NULL,
  `jednostka`        VARCHAR(20)   NULL,
  `data_waznosci`    DATE          NULL,
  `cena_netto`       DECIMAL(10,2) NULL,
  `cena_brutto`      DECIMAL(10,2) NULL,
  `kategoria`        VARCHAR(255)  NULL,
  `kto_dodal`        VARCHAR(100)  NULL,
  `data_dodania`     DATETIME      NULL,
  `kto_usunal`       VARCHAR(100)  NULL,
  `data_archiwizacji` TIMESTAMP    NULL DEFAULT CURRENT_TIMESTAMP,
  `utworzono_w`      TIMESTAMP     NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `Magazyn` (
  `id`             VARCHAR(50)   NOT NULL,
  `tenant_id`      VARCHAR(36)   NOT NULL,
  `nazwa_produktu` VARCHAR(255)  NULL,
  `typ`            VARCHAR(100)  NULL,
  `ilosc`          DECIMAL(10,2) NULL DEFAULT 0.00,
  `min`            DECIMAL(10,2) NULL DEFAULT 0.00,
  `jednostka`      VARCHAR(20)   NULL DEFAULT 'szt.',
  `data_waznosci`  DATE          NULL,
  `cena_netto`     DECIMAL(10,2) NULL,
  `cena_brutto`    DECIMAL(10,2) NULL,
  `kategoria`      VARCHAR(255)  NULL,
  `kto_dodal`      VARCHAR(100)  NULL,
  `data_dodania`   DATETIME      NULL,
  `utworzono_w`    TIMESTAMP     NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabele miesięczne (urodziny) - ta sama struktura x12
CREATE TABLE `Styczeń` (
  `id`           VARCHAR(36)  NOT NULL,
  `tenant_id`    VARCHAR(36)  NOT NULL,
  `c_status`     VARCHAR(50)  NULL,
  `nazwisko`     VARCHAR(150) NULL,
  `imie`         VARCHAR(100) NULL,
  `data_urodzin` DATE         NULL,
  `nr_telefonu`  VARCHAR(50)  NULL,
  `sms`          VARCHAR(10)  NULL,
  `telefon`      VARCHAR(10)  NULL,
  `komentarz`    TEXT         NULL,
  `utworzono_w`  TIMESTAMP    NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `Luty` LIKE `Styczeń`;
CREATE TABLE `Marzec` LIKE `Styczeń`;
CREATE TABLE `Kwiecień` LIKE `Styczeń`;
CREATE TABLE `Maj` LIKE `Styczeń`;
CREATE TABLE `Czerwiec` LIKE `Styczeń`;
CREATE TABLE `Lipiec` LIKE `Styczeń`;
CREATE TABLE `Sierpień` LIKE `Styczeń`;
CREATE TABLE `Wrzesień` LIKE `Styczeń`;
CREATE TABLE `Październik` LIKE `Styczeń`;
CREATE TABLE `Listopad` LIKE `Styczeń`;
CREATE TABLE `Grudzień` LIKE `Styczeń`;

CREATE TABLE `Koszty` (
  `id`          VARCHAR(50)   NOT NULL,
  `tenant_id`   VARCHAR(36)   NOT NULL,
  `data_kosztu` DATE          NULL,
  `kwota`       DECIMAL(10,2) NULL,
  `opis`        TEXT          NULL,
  `utworzono_w` TIMESTAMP     NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `Wyniki_konsultacja` (
  `id`               VARCHAR(50)   NOT NULL,
  `tenant_id`        VARCHAR(36)   NOT NULL,
  `data_wpisu`       DATETIME      NULL,
  `data_konsultacji` DATE          NULL,
  `zrodlo`           VARCHAR(50)   NULL,
  `obszar`           VARCHAR(100)  NULL,
  `klient`           VARCHAR(255)  NULL,
  `telefon`          VARCHAR(50)   NULL,
  `zabiegi_cialo`    TEXT          NULL,
  `zabiegi_twarz`    TEXT          NULL,
  `kwota_reklama`    DECIMAL(10,2) NULL DEFAULT 0.00,
  `kwota_pakiet`     DECIMAL(10,2) NULL DEFAULT 0.00,
  `upsell`           DECIMAL(10,2) NULL DEFAULT 0.00,
  `kto_wykonal`      VARCHAR(100)  NULL,
  `uwagi`            TEXT          NULL,
  `typ_akcji`        VARCHAR(255)  NULL,
  `utworzono_w`      TIMESTAMP     NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `Pracownicy_konsultacja` (
  `id`          VARCHAR(36)  NOT NULL,
  `tenant_id`   VARCHAR(36)  NOT NULL,
  `imie`        VARCHAR(100) NULL,
  `status`      VARCHAR(50)  NULL DEFAULT 'Aktywny',
  `utworzono_w` TIMESTAMP    NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `Typy_konsultacji` (
  `id`          VARCHAR(36)   NOT NULL,
  `tenant_id`   VARCHAR(36)   NOT NULL,
  `nazwa`       VARCHAR(255)  NULL,
  `obszar`      VARCHAR(100)  NULL,
  `cena`        DECIMAL(10,2) NULL DEFAULT 0.00,
  `prog`        DECIMAL(10,2) NULL DEFAULT 0.00,
  `opis`        TEXT          NULL,
  `status`      VARCHAR(50)   NULL DEFAULT 'Aktywna',
  `utworzono_w` TIMESTAMP     NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `Raport_Magazyn` (
  `id`          VARCHAR(50)   NOT NULL,
  `tenant_id`   VARCHAR(36)   NOT NULL,
  `kategoria`   VARCHAR(255)  NULL,
  `nazwa`       VARCHAR(255)  NULL,
  `ilosc`       DECIMAL(10,2) NULL,
  `min`         DECIMAL(10,2) NULL,
  `jednostka`   VARCHAR(20)   NULL,
  `data_zmiany` DATETIME      NULL,
  `edytowal`    VARCHAR(100)  NULL,
  `cena_netto`  DECIMAL(10,2) NULL,
  `cena_brutto` DECIMAL(10,2) NULL,
  `data_waznosci` DATE        NULL,
  `utworzono_w` TIMESTAMP     NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `Raport_Ustawienia` (
  `id`          VARCHAR(50)  NOT NULL,
  `tenant_id`   VARCHAR(36)  NOT NULL,
  `rola`        VARCHAR(50)  NULL,
  `imie`        VARCHAR(100) NULL,
  `nazwisko`    VARCHAR(100) NULL,
  `haslo`       VARCHAR(255) NULL,
  `utworzono_w` TIMESTAMP    NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `Raport_Kategorie` (
  `id`            VARCHAR(50)  NOT NULL,
  `tenant_id`     VARCHAR(36)  NOT NULL,
  `nazwa`         VARCHAR(255) NULL,
  `rodzic_id`     VARCHAR(50)  NULL,
  `pelna_sciezka` VARCHAR(255) NULL,
  `utworzono_w`   TIMESTAMP    NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `Pracownicy_targety` (
  `id`          VARCHAR(50)   NOT NULL,
  `tenant_id`   VARCHAR(36)   NOT NULL,
  `pracownik`   VARCHAR(100)  NULL,
  `miesiac`     VARCHAR(50)   NULL,
  `typ_targetu` VARCHAR(100)  NULL,
  `wartosc`     DECIMAL(10,2) NULL,
  `szczegoly`   TEXT          NULL,
  `opis_slowny` TEXT          NULL,
  `status`      VARCHAR(50)   NULL,
  `log_data`    DATETIME      NULL,
  `kto_dodal`   VARCHAR(100)  NULL,
  `min_cena`    DECIMAL(10,2) NULL,
  `utworzono_w` TIMESTAMP     NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================
-- KONIEC - uruchom teraz: node wielki_migrator.js
-- ============================================================
