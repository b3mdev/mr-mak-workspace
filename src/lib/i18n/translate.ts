import { isMac, isWindows } from '../../desktop/platform'
import { defaultUiLanguage, isUiLanguage, resolveUiLanguage, uiLanguageOptions, type UiLanguage } from '../../../desktop/service/language.mjs'
import { en, type MessageKey } from './en'
import { ptBR } from './pt-BR'

export type { MessageKey, UiLanguage }
export { defaultUiLanguage, isUiLanguage, resolveUiLanguage, uiLanguageOptions }

export const STORAGE_KEY = 'mrmak.uiLanguage'
export const CHANGED_EVENT = 'mrmak-ui-language'

export const catalogs: Record<UiLanguage, Record<MessageKey, string>> = {
  en,
  'pt-BR': ptBR,
}

// Known service-originated messages translated only at presentation time so API contracts and tests remain untouched.
const serviceToEn: Record<string, string> = {
  'Cole um convite completo para a Rede Bento.': 'Paste a complete Rede Bento invite.',
  'A Rede Bento está encerrando.': 'Rede Bento is shutting down.',
  'Ative o acesso pelo Tailscale neste computador para criar o convite.': 'Enable Tailscale access on this computer to create an invite.',
  'Desconecte-se da central antes de convidar computadores.': 'Disconnect from the hub before inviting computers.',
  'A central atingiu o limite de computadores.': 'The hub has reached the computer limit.',
  'Dados do computador inválidos.': 'Invalid computer details.',
  'Convite inválido, usado ou expirado.': 'Invalid, used, or expired invite.',
  'Este computador já pertence a uma central.': 'This computer already belongs to a hub.',
  'Computador não autorizado.': 'Unauthorized computer.',
  'Lista de tarefas inválida.': 'Invalid task list.',
  'Computador inválido.': 'Invalid computer.',
  'A central recusou o convite ou a conexão.': 'The hub declined the invite or connection.',
  'A central não aceitou a conexão.': 'The hub did not accept the connection.',
  'Resposta da central grande demais.': 'The hub response was too large.',
  'Uma conexão está em andamento.': 'A connection is already in progress.',
  'Encerre as conexões atuais antes de entrar em outra rede.': 'Close current connections before joining another network.',
  'Não foi possível alcançar a central. Verifique o Tailscale nos dois computadores.': 'Could not reach the hub. Check Tailscale on both computers.',
  'A central retornou uma identidade inválida.': 'The hub returned an invalid identity.',
  'Aguarde a conexão em andamento.': 'Wait for the current connection to finish.',
  'Conecte o computador pelo Tailscale Serve privado.': 'Connect the computer through private Tailscale Serve.',
}

const serviceToPtBR: Record<string, string> = {
  'The skill file is no longer available.': 'O arquivo da skill não está mais disponível.',
  'This agent does not support per-chat skill settings.': 'Este agente não oferece configurações de skills por chat.',
  'This skill file is read-only.': 'Este arquivo da skill é somente leitura.',
  'The skill changed on disk. Reopen the file before saving.': 'A skill mudou no disco. Reabra o arquivo antes de salvar.',
  'Enter skill instructions up to 256 KiB.': 'Escreva instruções para a skill de até 256 KiB.',
  'Choose a valid local file URL.': 'Escolha um endereço de arquivo local válido.',
  'The file or folder was not found. It may have been moved or renamed.': 'Não foi possível encontrar o arquivo ou a pasta. Verifique se o item foi movido ou renomeado.',
  'Choose a message to read earlier history.': 'Escolha uma mensagem para ler o histórico anterior.',
  'This conversation has no readable local history.': 'Esta conversa ainda não tem um histórico local legível.',
  'This chat does not have a saved native conversation yet.': 'Este chat ainda não tem uma sessão nativa salva.',
  'The original chat folder is unavailable.': 'A pasta original do chat está indisponível.',
  'Windows Terminal is required to continue this chat outside Bento.': 'O Windows Terminal é necessário para continuar este chat fora do Bento.',
  'A graphical terminal is required to continue this chat outside Bento.': 'Um terminal gráfico é necessário para continuar este chat fora do Bento.',
  'This agent does not support continuing outside Bento.': 'Este agente não permite continuar a sessão fora do Bento.',
  'The Antigravity conversation ID is invalid.': 'O identificador da conversa no Antigravity é inválido.',
  'The original agent CLI is unavailable.': 'O CLI do agente original está indisponível.',
  'This chat is already opening or closing.': 'Este chat já está abrindo ou fechando.',
  'Finish the current turn before moving this conversation.': 'Conclua o turno atual antes de transferir esta conversa.',
  'This conversation is moving to another application.': 'Esta conversa está sendo transferida para outro aplicativo.',
  'The external app could not open. Your conversation is saved in Bento History.': 'Não foi possível abrir o destino. A conversa está salva no Histórico do Bento.',
  'The coordinator request was stopped. Check the target before repeating an action.': 'O pedido foi interrompido. Confira o destino antes de repetir a ação.',
  'The coordinator context changed. Send the request again if needed.': 'O contexto mudou. Envie o pedido novamente se precisar.',
  'The coordinator timed out. Inspect chats before retrying; actions may already have been delivered.': 'O coordenador demorou demais. Confira os chats antes de tentar de novo, pois alguma ação pode já ter sido enviada.',
  'Context append text must not exceed 500 tokens.': 'A voz recebeu contexto demais. Use Nova conversa e inicie a voz novamente.',
  'Use an English chat name. Messages can be in any language.': 'Use um nome de chat em inglês. As mensagens podem ser em qualquer idioma.',
  'Use an English group name. Messages can be in any language.': 'Use um nome de grupo em inglês. As mensagens podem ser em qualquer idioma.',
  'Choose a supported speech-to-text provider.': 'Escolha um provedor de ditado compatível.',
  'Choose a supported reading voice and a short text segment.': 'Escolha uma voz de leitura compatível e um trecho de texto curto.',
  'Choose a supported interface language.': 'Escolha um idioma de interface compatível.',
  'Choose files of 1 GB or less.': 'Escolha arquivos de até 1 GB.',
  'Choose an image smaller than 25 MB.': 'Escolha uma imagem menor que 25 MB.',
  'Write a message or attach a file.': 'Escreva uma mensagem ou anexe um arquivo.',
  'Write a message or attach an image.': 'Escreva uma mensagem ou anexe uma imagem.',
  'Enable mobile access first.': 'Ative o acesso móvel primeiro.',
  'Too many pairing attempts. Wait a minute and try again.': 'Muitas tentativas de pareamento. Aguarde um minuto e tente novamente.',
  'This QR code has expired or was already used. Create a new one in Chats.': 'Este QR code expirou ou já foi usado. Crie um novo em Chats.',
  'Disconnect an old device before adding another.': 'Desconecte um dispositivo antigo antes de adicionar outro.',
  'This connection request has expired.': 'Esta solicitação de conexão expirou.',
  'Connection request expired. Scan a new QR code.': 'Solicitação de conexão expirada. Escaneie um novo QR code.',
  'Connect this phone from the QR code in Bento Workspace Chats.': 'Conecte este celular pelo QR code em Bento Workspace Chats.',
  'This phone is disconnected. Scan a new QR code in Chats.': 'Este celular está desconectado. Escaneie um novo QR code em Chats.',
  'Mobile access is off. Enable it in Bento Workspace Chats.': 'O acesso móvel está desativado. Ative-o em Bento Workspace Chats.',
  'Resume this chat before sending a message.': 'Retome este chat antes de enviar uma mensagem.',
  'An attachment expired. Attach the image again.': 'Um anexo expirou. Anexe a imagem novamente.',
  'The chat stopped before delivery.': 'O chat parou antes da entrega.',
  'This phone was disconnected before delivery.': 'Este celular foi desconectado antes da entrega.',
  'Check the terminal before sending again. Delivery could not be confirmed.': 'Verifique o terminal antes de enviar novamente. Não foi possível confirmar a entrega.',
  'Local Whisper is not installed. Run the local dictation setup on your computer.': 'O Whisper local não está instalado. Execute a configuração de ditado local no computador.',
  'Voice input needs OPENROUTER_API_KEY or OPENAI_API_KEY in the computer workspace .env. Your keyboard microphone still works.': 'A entrada por voz precisa de OPENROUTER_API_KEY ou OPENAI_API_KEY no .env do Workspace no computador. O microfone do teclado continua funcionando.',
  'Another recording is being transcribed. Wait a moment and retry.': 'Outra gravação está sendo transcrita. Aguarde um momento e tente novamente.',
  'Transcription is busy. Wait a moment and retry.': 'A transcrição está ocupada. Aguarde um momento e tente novamente.',
  'Please wait a minute before transcribing another recording.': 'Aguarde um minuto antes de transcrever outra gravação.',
  'Recording is too large. Record a shorter message.': 'A gravação ficou grande demais. Grave uma mensagem mais curta.',
  'The recording is empty or damaged. Try recording again.': 'A gravação está vazia ou corrompida. Tente gravar novamente.',
  'This audio format is not supported. Use your keyboard microphone instead.': 'Este formato de áudio não é compatível. Use o microfone do teclado.',
  'Add OPENAI_API_KEY to the repository .env, then press the nose again.': 'Adicione OPENAI_API_KEY ao .env do repositório e tente novamente.',
}

export type TranslationParams = Record<string, string | number>

export function readStoredLanguage(): UiLanguage {
  try {
    return resolveUiLanguage(typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null)
  } catch {
    return defaultUiLanguage
  }
}

export function writeStoredLanguage(language: UiLanguage) {
  try {
    localStorage.setItem(STORAGE_KEY, language)
  } catch { /* Storage may be restricted in sandboxed browsers. */ }
}

export function currentDocumentLanguage(): UiLanguage {
  if (typeof document !== 'undefined') {
    const attr = document.documentElement.dataset.uiLanguage
    if (isUiLanguage(attr)) return attr
  }
  return readStoredLanguage()
}

/** Translates a catalog key with guaranteed English fallback and safe `{param}` interpolation. */
export function translate(language: UiLanguage | string, key: MessageKey, params?: TranslationParams): string {
  const resolved = resolveUiLanguage(language)
  const template = catalogs[resolved]?.[key] ?? catalogs.en[key] ?? key
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name) => Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match)
}

export function tNow(key: MessageKey, params?: TranslationParams): string {
  return translate(currentDocumentLanguage(), key, params)
}

export function translateServiceMessage(language: UiLanguage, message: string): string {
  if (!message) return message
  if (language === 'en') return serviceToEn[message] ?? message
  if (language === 'pt-BR') return serviceToPtBR[message] ?? message
  return message
}

export function localeFor(language: UiLanguage): string {
  return language === 'pt-BR' ? 'pt-BR' : 'en-US'
}

export function formatLocaleDate(language: UiLanguage, value: Date | string | number, options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }): string {
  return new Intl.DateTimeFormat(localeFor(language), options).format(value instanceof Date ? value : new Date(value))
}

export function formatLocaleTime(language: UiLanguage, value: Date | string | number): string {
  return new Intl.DateTimeFormat(localeFor(language), { hour: '2-digit', minute: '2-digit' }).format(value instanceof Date ? value : new Date(value))
}

export function formatLocaleDateTime(language: UiLanguage, value: Date | string | number, options: Intl.DateTimeFormatOptions = { dateStyle: 'short', timeStyle: 'short' }): string {
  return new Intl.DateTimeFormat(localeFor(language), options).format(value instanceof Date ? value : new Date(value))
}

export function formatLocaleNumber(language: UiLanguage, value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(localeFor(language), options).format(value)
}

export function localizeFileManager(language: UiLanguage): string {
  if (isMac) return 'Finder'
  if (isWindows) return translate(language, 'platform.explorer')
  return translate(language, 'platform.fileManager')
}

export function localizeTrashName(language: UiLanguage): string {
  return isWindows ? translate(language, 'platform.recycleBin') : translate(language, 'platform.trash')
}

export function localizeCategory(language: UiLanguage, category: string): string {
  const key = `category.${category}` as MessageKey
  if (Object.prototype.hasOwnProperty.call(en, key)) return translate(language, key)
  return category.replace(/-/g, ' ')
}

export function localizeCategoryTitle(language: UiLanguage, category: string): string {
  const label = localizeCategory(language, category)
  return label.split(' ').map(word => word ? word.charAt(0).toUpperCase() + word.slice(1) : word).join(' ')
}

export function localizeEffort(language: UiLanguage, effort: string, lower = false): string {
  const key = `effort.${effort}${lower ? 'Lower' : ''}` as MessageKey
  return Object.prototype.hasOwnProperty.call(en, key) ? translate(language, key) : effort
}

export function localizeTabColor(language: UiLanguage, name: string): string {
  const key = `color.${name}` as MessageKey
  return Object.prototype.hasOwnProperty.call(en, key) ? translate(language, key) : name
}

export function localizeThemeDescription(language: UiLanguage, id: string, fallback: string): string {
  const key = `theme.desc.${id}` as MessageKey
  return Object.prototype.hasOwnProperty.call(en, key) ? translate(language, key) : fallback
}
