-- Migracja: Planowanie kosztów szczegółowych
-- Uruchom raz na bazie Estelio

CREATE TABLE IF NOT EXISTS Koszty_Kategorie (
  id            VARCHAR(36)  NOT NULL PRIMARY KEY,
  tenant_id     VARCHAR(64)  NOT NULL,
  lp            INT          NOT NULL,
  nazwa         VARCHAR(200) NOT NULL,
  typ           ENUM('stała','zmienna','mieszana') NOT NULL DEFAULT 'stała',
  aktywna       TINYINT(1)   NOT NULL DEFAULT 1,
  predefiniowana TINYINT(1)  NOT NULL DEFAULT 0,
  data_dodania  DATE         NOT NULL,
  INDEX idx_tenant (tenant_id),
  UNIQUE KEY uniq_tenant_lp (tenant_id, lp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS Koszty_Szczegoly (
  id            VARCHAR(36)    NOT NULL PRIMARY KEY,
  tenant_id     VARCHAR(64)    NOT NULL,
  miesiac_rok   VARCHAR(7)     NOT NULL,
  kategoria_id  VARCHAR(36)    NOT NULL,
  czesc_stala   DECIMAL(10,2)  NOT NULL DEFAULT 0,
  czesc_zmienna DECIMAL(10,2)  NOT NULL DEFAULT 0,
  INDEX idx_tenant_month (tenant_id, miesiac_rok),
  UNIQUE KEY uniq_tenant_month_kat (tenant_id, miesiac_rok, kategoria_id),
  CONSTRAINT fk_ks_kat FOREIGN KEY (kategoria_id) REFERENCES Koszty_Kategorie(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
