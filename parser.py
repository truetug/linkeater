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

try:
    from tornado.escape import json_decode
    from tornado import gen
    from tornado.ioloop import IOLoop
    from tornado.options import define, options, \
        parse_command_line, parse_config_file
    from tornado.web import Application, RequestHandler, StaticFileHandler
    from tornado.httpclient import AsyncHTTPClient
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
    )

    print('\n'.join(msg).format(' '.join(requirements), __file__))
    exit(1)


NAME = 'ccbI/I0rpbI3'
WORD_RE = re.compile(
    r'(?:^|(?<=\s))(\w{6})(?:(?=\s)|$)',
    flags=(re.MULTILINE | re.UNICODE)
)
IGNORE_TAGS = ('script', 'style', 'pre', 'code', 'iframe')
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_ROOT = os.path.join(BASE_DIR, 'static')

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

define('concurrency', default=2, help='Number of worker for parsing urls')


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

    slug = None
    url = None
    status = None
    style = None

    created_at = None
    updated_at = None

    response = None
    content = None
    soup = None

    title = None
    heading = None
    image = None

    message = None
    progress = 0

    def __init__(self, url):
        self.slug = uuid4().hex
        self.url = self.prepare(url)
        self.up(status=self.STATUS_NEW)

    def as_json(self):
        result = {
            'slug': self.slug,
            'url': self.url,
            'status': self.status,
            'message': self.message,
            'progress': self.progress,
            'style': self.style,
        }

        if self.status == Task.STATUS_SUCCESS:
            result.update({
                'title': self.title,
                'heading': self.heading,
                'image': self.image,
            })

        return result

    def process(self):
        logger.info('Process url "%s"', self.url)

        self.soup = bs4.BeautifulSoup(self.content, 'html5lib')
        # import ipdb; ipdb.set_trace()

        tmp = self.soup.find('title')
        if tmp:
            self.title = tmp.text.strip()

        tmp = self.soup.find('h1')
        if tmp:
            self.heading = tmp.text.strip()

        tmp = self.soup.find('img[src]')
        if tmp:
            self.image = tmp.get('src')

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

    def get_status(self):
        return self.status

    def prepare(self, url):
        url = url and urldefrag(url).url
        return url

    @gen.coroutine
    def request(self):
        logger.info('Request url "%s"', self.url)
        self.up(status=self.STATUS_REQUEST)

        try:
            response = yield AsyncHTTPClient().fetch(self.url)
            self.up(status=self.STATUS_PROCESS, progress=25)
            yield gen.sleep(0.5)

            self.response = response
            self.content = response.body
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
        logger.debug('Parsed url:\n%s', self.as_json())
        raise gen.Return(True)

    def parse(self):
        pass


class TaskDispatcher(object):
    _instance = None
    storage = {
        'tasks': OrderedDict(),
        'queue': [],
    }

    def __new__(cls, *args, **kwargs):
        if not cls._instance:
            cls._instance = super(TaskDispatcher, cls).__new__(cls, *args, **kwargs)

        return cls._instance

    def __init__(self):
        pass

    def add(self, url):
        logger.info('Adding url "%s"', url)
        task = self.storage['tasks'].get(url)
        if not task or task.status != Task.STATUS_SUCCESS:
            task = Task(url)
            self.storage['tasks'][task.slug] = task
            self.storage['queue'].append(task)
        else:
            task.message = 'URL "{}" is already parsed'.format(url)

    def remove(self, slug):
        logger.info('Removing task "%s"', slug)
        result = False
        if slug in self.storage['tasks']:
            del(self.storage['tasks'][slug])
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
            if status and task.status != status:
                continue

            if url and task.url != url:
                continue

            result.append(task.as_json())

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
    """
    Opens browser after app start
    """
    if not options.debug:
        url = "{scheme}://{address}:{port}".format(
            scheme=options.scheme,
            address=options.address,
            port=options.port
        )

        webbrowser.open(url, new=2)

    # Start workers, then wait for the work queue to be empty.
    for _ in range(options.concurrency):
        worker(_)


def on_signal(signum, frame):
    """
    Handles signals
    """
    logger.info('%s shutdowned because of %s',
        NAME,
        '{0} signal was recieved'.format(on_signal.signals.get(signum, signum))
    )

    exit(0)
on_signal.signals = {2: 'INT', 15: 'TERM'}


@gen.coroutine
def get_url_content(task):
    try:
        response = yield AsyncHTTPClient().fetch(task.url)
        content = response.body
    except Exception as error:
        response = error.response
        content = response.body

    raise gen.Return((response.code, content))


class MainHandler(RequestHandler):
    def get(self):
        self.render('templates/main.html')


class ApiHandler(RequestHandler):
    limit = 3

    def handle_pagination(self, total=0):
        offset = self.get_argument('offset', 0)
        pages = ceil(truediv(total, self.limit))
        page = offset and ceil(truediv(total, offset))

        url = '{scheme}://{address}:{port}/api/{resource}/'.format(
            address=options.address,
            scheme=options.scheme,
            port=options.port,
            resource=self.resource
        )
        return {}

    def get(self, slug=None):
        data = self.handle_get(slug)

        if isinstance(data, list):
            result = {
                'meta': self.handle_pagination(len(data)),
                'objects': data,
            }

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
        """
        Получить список тасков или детали по конкретному таску
        """
        data = []

        url = self.get_argument('url', None)
        status = self.get_argument('status', None)
        return self.storage.list(url, status)

    def handle_post(self, data):
        """
        Поставить таск на загрузку урла
        """
        result = None

        if data and 'url' in data:
            self.storage.add(data.get('url'))
        else:
            self.set_status(400)

        return result

    def delete(self, slug):
        result = self.storage.remove(slug)
        self.write('OK')


def main():
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
