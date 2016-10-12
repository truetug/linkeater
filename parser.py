#!/usr/bin/env python
# encoding: utf-8

# Разработать приложение для парсинга страниц.
#
# Требования:
# * Серверная часть приложения должна быть написана на языке Python;
# * В процессе парсинга страница не должна перезагружаться;
#
# Сценарий работы:
# * Пользователь открывает страницу.
# * Вводит список URL до 5 штук за раз. Далее вводит информацию о дате времени, иначе используется текущая дата. Нажимает на кнопку Ок.
# * Затем в режиме реального времени (без перезагрузки страницы), в специальных блоках наблюдает за прогрессом, статусом парсинга, который начинается в указанное время. Процесс может быть остановлен спец кнопкой. Это должен быть правдивый прогресс бар или меняющийся список статусов.
# * Парсинг всех введенных URL должен происходить параллельно. Если имеются 5 URL которые еще не подверглись парсингу, то создавать новые задачи нельзя.
# * Результатом парсинга одного URL является HTML блок который ранее содержал статус. После завершения процесса он должен содержать:
#   1. URL
#   2. Содержимое тега title
#   3. Содержимое первого тега H1, если он есть
#   4. Первое изображение из тега img, если он есть. Оно должно быть на фоне этого блока (ссылка на копию изображения на сервисе)
# * Изображение должно быть закачено на сервис и процесс загрузки этого файла нужно отобразить в прогресс баре.
# * Обновление страницы не должно приводить к потере каких либо данных или прогресса парсинга.
# * Блоки с результатами парсинга должны быть разбиты на станицы по 3 блока на одной
# * Желательно оформить сервис в систему виртулизации docker­compose, Vagrant и пр...

import re
import os
import imp
import signal
import logging
import webbrowser
from collections import OrderedDict
from urllib.parse import urldefrag
from math import ceil
from operator import truediv
from uuid import uuid4
from time import time
from urllib.parse import urlparse, urljoin, urlencode
from datetime import datetime
import shutil
import shlex

try:
    from tornado.escape import json_decode
    from tornado import gen
    from tornado.websocket import WebSocketHandler, websocket_connect
    from tornado.process import Subprocess
    from tornado.ioloop import IOLoop
    from tornado.options import define, options, \
        parse_command_line, parse_config_file
    from tornado.web import Application, RequestHandler, StaticFileHandler
    from tornado.httpclient import AsyncHTTPClient, HTTPRequest
    import bs4
    imp.find_module('html5lib')
except ImportError:
    requirements = (
        'tornado==4.3',
        'html5lib==0.9999999',
        'beautifulsoup4==4.4.1'
    )

    msg = (
        'Please install requirements:',
        'virtualenv env && '
        '. env/bin/activate && '
        'pip install {0} && python {1}',
        '',
        'For screenshots support install wkhtmltopdf'
    )

    print('\n'.join(msg).format(' '.join(requirements), __file__))
    exit(1)


NAME = 'ccbI/I0rpbI3'
VERSION = (1, 0, 0)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_URL = '/static/'
STATIC_ROOT = os.path.join(BASE_DIR, 'static')
MEDIA_URL = '/media/'
MEDIA_ROOT = os.path.join(BASE_DIR, 'media')
PDF_CMD = 'wkhtmltoimage -q {url} {file}'

logger = logging.getLogger(NAME)
logger.setLevel(logging.INFO)
ch = logging.StreamHandler()
ch.setLevel(logging.INFO)
logger.addHandler(ch)

define('scheme', default='http', help="")
define('address', default='127.0.0.1', help="address to listen on")
define('port', default=8888, help="port to listen on")
define('config_file', default='config.cfg',
       help='filename for additional configuration')

define('debug', default=False, group='application',
       help="run in debug mode (with automatic reloading)")
define('proxy_host', default='habrahabr.ru', group='application',
       help="host proxy to")

define('concurrency', default=5, help='Number of worker for parsing urls')


def check_url(url):
    result = urlparse(url)
    return True

def get_datetime(dt):
    result = None

    try:
        dt = dt.replace('T', '-').replace(':', '-')
        result = dt and datetime(*map(int, dt.split('-')))
    except ValueError:
        pass

    return result


class Task(object):
    STATUS_NEW = 0
    STATUS_REQUEST = 5
    STATUS_PROCESS = 10
    STATUS_SUCCESS = 20
    STATUS_FAIL = 30
    STATUS_CANCEL = 40

    STATUS_LIST = (
        STATUS_NEW,
        STATUS_PROCESS,
        STATUS_SUCCESS,
        STATUS_FAIL,
        STATUS_CANCEL,
    )

    STYLE = {
        STATUS_CANCEL: 'secondary',
        STATUS_SUCCESS: 'success',
        STATUS_FAIL: 'alert',
    }

    file_mapping = {
        'image': 'image_{slug}.jpg',
        'screenshot': 'screenshot_{slug}.jpg',
    }

    slug = None
    url = None
    status = None
    style = None

    created_at = None
    updated_at = None

    response = None
    content = b''
    soup = None

    title = None
    heading = None
    image_file = None

    message = None
    progress = 0

    cl = 0
    dl = 0

    def __init__(self, url):
        self.slug = uuid4().hex
        self.url = self.prepare(url)
        self.up(status=self.STATUS_NEW)

    def __str__(self):
        return 'Task on parsing url "{}"'.format(self.url)

    def as_json(self):
        result = {
            'slug': self.slug,
            'url': self.url,
            'status': self.status,
            'message': self.message,
            'progress': self.progress,
            'style': self.style,
            'dl': round(self.dl / 1024),
            'created_at': self.created_at,
        }

        if self.status == Task.STATUS_SUCCESS:
            result.update({
                'title': self.title,
                'heading': self.heading,
                'image': self.get_url('image'),
                'screenshot': self.get_url('screenshot'),
            })

        return result

    def get_url(self, key):
        path, url = self.get_path(key), self.get_path(key, is_url=True)
        return os.path.isfile(path) and url or None

    def get_path(self, key, is_url=False):
        result = None
        filename = self.file_mapping.get(key)
        filename = filename and filename.format(slug=self.slug)
        if filename:
            root = MEDIA_URL if is_url else MEDIA_ROOT
            result = os.path.join(root, filename)

        return result

    @gen.coroutine
    def process(self):
        logger.info('Processing url "%s"', self.url)

        self.soup = bs4.BeautifulSoup(self.content, 'html5lib')

        tmp = self.soup.find('title')
        if tmp and tmp.string:
            self.title = tmp.string.strip()

        tmp = self.soup.find('h1')
        if tmp and tmp.string:
            self.heading = tmp.string.strip()

        tmp = self.soup.find('img', src=True)
        if tmp:
            tmp = urljoin(self.url, tmp.get('src'))
            logger.info('Downloading image "%s"', tmp)
            fp = open(self.get_path('image'), 'wb')
            yield AsyncHTTPClient().fetch(
                HTTPRequest(
                    url=tmp,
                    streaming_callback=lambda c: fp.write(c),
                )
            )
            fp.close()

        logger.info('Downloading screenshot of "%s"', self.url)
        yield call_subprocess(
            PDF_CMD.format(
                url=self.url, 
                file=self.get_path('screenshot')
            ),
            exit_callback=lambda x: self.up()
        )

    def up(self, **kwargs):
        now = time()

        if not self.created_at:
            self.created_at = now

        self.updated_at = now

        tmp = kwargs.get('status')
        if tmp in self.STATUS_LIST:
            self.status = tmp
            self.style = Task.STYLE.get(tmp)

        tmp = kwargs.get('progress')
        if tmp and 0 <= tmp <= 100:
            self.progress = tmp

        self.message = kwargs.get('message')
        TaskDispatcher().update()


    def get_status(self):
        return self.status

    def prepare(self, url):
        url = url and urldefrag(url).url
        return url

    def on_head(self, *args, **kwargs):
        for header in args:
            header = header.lower()
            if 'content-length' in header:
                self.cl = int(header.split(':')[-1].strip())
            elif 'content-type' in header and 'text/html' not in header:
                # Тут надо всё прекращать
                pass

    def on_stream(self, chunk):
        self.dl += len(chunk)
        self.content += chunk
        if self.cl:
            progress = round(25 + (self.dl / self.cl * 25))
            self.up(progress=progress)

    def on_image_stream(self, chunk):
        self.image_fp.write(chunk)

    @gen.coroutine
    def request(self):
        logger.info('Requesting url "%s"', self.url)

        self.up(status=self.STATUS_REQUEST)

        try:
            response = yield AsyncHTTPClient().fetch(
                HTTPRequest(
                    url=self.url,
                    header_callback=self.on_head,
                    streaming_callback=self.on_stream,
                )
            )
            self.up(status=self.STATUS_PROCESS, progress=25)
            yield gen.sleep(0.5)

            self.response = response
            self.up(progress=50)
            yield gen.sleep(0.5)

            self.process()
            yield gen.sleep(0.5)

            self.up(status=Task.STATUS_SUCCESS)
        except Exception as error:
            self.response = getattr(error, 'response', None) or error
            self.message = str(error)
            self.up(status=Task.STATUS_FAIL)

        self.up(progress=100)
        logger.debug('Parsed url data:\n%s', self.as_json())
        raise gen.Return(True)


class TaskDispatcher(object):
    _instance = None
    storage = {
        'tasks': {},
        'queue': [],
    }

    def __new__(cls, *args, **kwargs):
        # Just a singleton
        if not cls._instance:
            cls._instance = super(TaskDispatcher, cls).__new__(cls, *args, **kwargs)

        return cls._instance

    def update(self):
        EchoWebSocket.update(self.list())

    def add(self, url):
        logger.info('Adding url "%s"', url)
        task = self.storage['tasks'].get(url)
        if not task or task.status != Task.STATUS_SUCCESS:
            task = Task(url)
            self.storage['tasks'][task.slug] = task
            self.storage['queue'].append(task)

    def remove(self, slug):
        logger.info('Removing task "%s"', slug)
        result = False
        if slug in self.storage['tasks']:
            task = self.storage['tasks'][slug]

            try:
                os.remove(task.image_file)
            except (OSError, TypeError):
                pass

            try:
                del(self.storage['tasks'][slug])
            except IndexError:
                pass

            result = True

        return result

    def get(self, slug):
        task = self.storage['tasks'].get(slug)
        return task

    def list(self, url=None, status=None):
        status = status in Task.STATUS_LIST and status
        task_list = self.storage['tasks']

        result = []
        for task in task_list.values():
            # Kind of status filter
            if status and task.status != status:
                continue

            # Kind of url filter
            if url and task.url != url:
                continue

            result.append(task.as_json())

        result.sort(key=lambda x: -x['created_at'])
        return result

    def pop(self):
        queue = self.storage['queue']
        return queue and queue.pop(0) or None


@gen.coroutine
def worker(i):
    logger.info('Starting worker %s', i)

    while True:
        task = TaskDispatcher().pop()
        if task:
            logger.info('Get task %s', task)
            yield task.request()
        else:
            yield gen.sleep(0.01)


@gen.coroutine
def on_start():
    # Opens browser after app start
    if not options.debug:
        url = "{scheme}://{address}:{port}".format(
            scheme=options.scheme,
            address=options.address,
            port=options.port
        )

        webbrowser.open(url, new=2)

    # Start workers
    for _ in range(options.concurrency):
        worker(_)


def on_signal(signum, frame):
    """
    Handle signals
    """
    logger.info('%s shutdowned because of %s',
        NAME,
        '{0} signal was recieved'.format(on_signal.signals.get(signum, signum))
    )

    exit(0)
on_signal.signals = {2: 'INT', 15: 'TERM'}


@gen.coroutine
def call_subprocess(cmd, data=None, exit_callback=None):
    cmd = cmd and shlex.split(cmd)

    subprocess = cmd and Subprocess(
        cmd, 
        stdin=Subprocess.STREAM, 
        stdout=Subprocess.STREAM, 
        stderr=Subprocess.STREAM,
    )

    if data:
        yield subprocess.stdin.write(data)
        subprocess.stdin.close()

    result = subprocess and (yield [
        subprocess.stdout.read_until_close(),
        subprocess.stderr.read_until_close(),
        subprocess.wait_for_exit(raise_error=False),
    ])

    if callable(exit_callback):
        exit_callback(result)


def get_paged(items, page=0, limit=3):
    result = 3
    total = len(items)
    pages = ceil(truediv(total, limit))
    if 0 <= page <= pages:
        offset = page * limit

        result = {
            'meta': {
                'total': pages,
                'current': page,
            },
            'objects': items[offset:offset + limit],
        }

    return result

class MainHandler(RequestHandler):
    def get(self):
        self.render('templates/main.html')



class ApiHandler(RequestHandler):
    def get(self, slug=None):
        data = self.handle_get(slug)
        page = self.get_argument('page', None)
        page = page and page.isdigit() and int(page) or 0
        result = get_paged(data, page)

        if not result:
            self.set_status(404)

        self.write(result)

    def handle_get(self, slug):
        return []

    def post(self):
        data = json_decode(self.request.body)
        content = self.handle_post(data)
        self.write(content or 'OK')

    def handle_post(self, data):
        logger.info('Create object with data: %s', data)


class TaskHandler(ApiHandler):
    resource = 'task'

    def __init__(self, *args, **kwargs):
        super(TaskHandler, self).__init__(*args, **kwargs)
        self.storage = TaskDispatcher()

    def handle_get(self, slug):
        data = []

        url = self.get_argument('url', None)
        status = self.get_argument('status', None)
        return self.storage.list(url, status)

    def handle_post(self, data):
        result = None

        url = data.get('url')
        date = data.get('date')
        if url:
            delay = date and round(int(get_datetime(date).strftime('%s')) - time())
            if delay and delay > 59:
                logger.info('Schedule url "%s" after %s seconds', url, delay)
                IOLoop.instance().call_later(
                    delay, lambda: self.storage.add(url),
                )
            else:
                self.storage.add(url)

        else:
            self.set_status(400)

        return result

    def delete(self, slug):
        result = self.storage.remove(slug)
        self.write('OK')


class EchoWebSocket(WebSocketHandler):
    clients = set()

    def __init__(self, *args, **kwargs):
        super(EchoWebSocket, self).__init__(*args, **kwargs)
        self.storage = TaskDispatcher()

    def check_origin(self, origin):
        return True

    def open(self):
        print("WebSocket opened")
        EchoWebSocket.clients.add(self)

    def on_message(self, message):
        try:
            data = json_decode(message)
        except:
            data = {}

        print('received:', message, data)
        self.write_message(u"You said: " + message)

    def on_close(self):
        print("WebSocket closed")

    @classmethod
    def update(cls, message):
        for client in cls.clients:
            try:
                data = {
                    'objects': message,
                }
                client.write_message(data)
            except:
                logger.error("Error sending message", exc_info=True)


def main():
    # Prepare media dir
    try:
        shutil.rmtree(MEDIA_ROOT)
    except OSError:
        pass

    try:
        os.makedirs(MEDIA_ROOT)
    except OSError:
        logger.error('Something wrong with media directory "%s"', MEDIA_ROOT)

    # Catch signals
    signal.signal(signal.SIGINT, on_signal)
    signal.signal(signal.SIGTERM, on_signal)

    parse_command_line(final=False)
    if os.path.isfile(options.config_file):
        parse_config_file(options.config_file)

    logger.info('Come along tornado %s:%s...', options.address, options.port)

    if options.debug:
        logger.setLevel(logging.DEBUG)

    logger.debug(
        u'\nOptions\n===\n%s\n',
        u'\n'.join([u'{0}: {1}'.format(k, v) for k, v in options.items()])
    )

    app = Application([
        (r'/api/task/$', TaskHandler),
        (r'/api/task/([^/]+)/$', TaskHandler),
        (r'/static/(.*)', StaticFileHandler, {'path': STATIC_ROOT}),
        (r'/media/(.*)', StaticFileHandler, {'path': MEDIA_ROOT}),
        (r'/websocket/$', EchoWebSocket),
        (r'.+', MainHandler),
    ], **options.group_dict('application'))

    app.listen(options.port, options.address)
    ioloop = IOLoop.current()
    ioloop.add_callback(on_start)
    ioloop.start()


if __name__ == "__main__":
    main()
else:
    logger.info('Running %s', __name__)
